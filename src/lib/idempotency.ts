import { NextRequest, NextResponse } from "next/server";
import { pgPool as pool } from "@/lib/db";

/**
 * Exec returns either {status, body} OR a NextResponse. We always return a NextResponse.
 * IMPORTANT: if a NextResponse is returned, we CLONE it before reading JSON for persistence,
 * to avoid locking/consuming the stream ("ReadableStream is locked" issue).
 */
export async function withIdempotency(
  req: NextRequest,
  exec: () => Promise<{ status: number; body: any } | NextResponse>
): Promise<NextResponse> {
  const key = req.headers.get("Idempotency-Key");
  if (!key) {
    const r = await exec();
    if (r instanceof NextResponse) return r;
    return NextResponse.json(r.body, { status: r.status });
  }

  const method = req.method;
  const path = new URL(req.url).pathname;
  const c = await pool.connect();

  try {
    await c.query("BEGIN");
    try {
      await c.query(
        `INSERT INTO idempotency(key, method, path, "createdAt")
         VALUES ($1,$2,$3,NOW())`,
        [key, method, path]
      );
    } catch (e: any) {
      if (e?.code === "23505") {
        const { rows } = await c.query(
          `SELECT status, response FROM idempotency WHERE key=$1`,
          [key]
        );
        await c.query("COMMIT");
        if (rows[0]) return NextResponse.json(rows[0].response, { status: rows[0].status });
        return NextResponse.json({ error: "Idempotency replay but no record" }, { status: 409 });
      }
      if (e?.code === "42P01") {
        // idempotency table missing in some envs → just run
        await c.query("ROLLBACK");
        const r = await exec();
        if (r instanceof NextResponse) return r;
        return NextResponse.json(r.body, { status: r.status });
      }
      throw e;
    }

    const r = await exec();

    let status: number;
    let body: any;
    let response: NextResponse;

    if (r instanceof NextResponse) {
      status = r.status;
      // clone before reading body to avoid stream lock
      try {
        const cloned = r.clone();
        body = await cloned.json().catch(() => ({}));
      } catch {
        body = {};
      }
      response = r;
    } else {
      status = r.status;
      body = r.body;
      response = NextResponse.json(body, { status });
    }

    await c.query(
      `UPDATE idempotency
          SET status=$2, response=$3, "updatedAt"=NOW()
        WHERE key=$1`,
      [key, status, body]
    );

    await c.query("COMMIT");
    return response;
  } catch (err) {
    await c.query("ROLLBACK");
    throw err;
  } finally {
    c.release();
  }
}
