// src/lib/http/with-idempotency.ts
import { NextRequest, NextResponse } from "next/server";
import { pgPool as pool } from "@/lib/db";

/**
 * Exec returns either {status, body} OR a NextResponse. We always return a NextResponse.
 * IMPORTANT: if a NextResponse is returned, we CLONE it before reading for persistence,
 * to avoid locking/consuming the stream ("ReadableStream is locked").
 */
export async function withIdempotency(
  req: NextRequest,
  exec: () => Promise<{ status: number; body: any } | NextResponse>
): Promise<NextResponse> {
  const key = req.headers.get("Idempotency-Key");
  if (!key) {
    const r = await exec();
    return r instanceof NextResponse ? r : NextResponse.json(r.body, { status: r.status });
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
        // table missing in some envs → best-effort passthrough
        await c.query("ROLLBACK");
        const r = await exec();
        return r instanceof NextResponse ? r : NextResponse.json(r.body, { status: r.status });
      }
      throw e;
    }

    const r = await exec();

    // Decide what to persist WITHOUT consuming the original stream
    const status = r instanceof NextResponse ? r.status : r.status;
    let storedBody: any = null;

    if (r instanceof NextResponse) {
      try {
        const clone = r.clone(); // safe copy
        const ct = (clone.headers.get("content-type") || "").toLowerCase();
        if (ct.includes("application/json")) {
          storedBody = await clone.json().catch(() => null);
        } else {
          const text = await clone.text().catch(() => "");
          // avoid giant rows
          storedBody = { text: text.slice(0, 4096) };
        }
      } catch {
        storedBody = null;
      }
    } else {
      storedBody = r.body ?? null;
    }

    await c.query(
      `UPDATE idempotency
         SET status=$2, response=$3, "updatedAt"=NOW()
       WHERE key=$1`,
      [key, status, storedBody]
    );
    await c.query("COMMIT");

    // Return the original response untouched
    return r instanceof NextResponse ? r : NextResponse.json(r.body, { status });
  } catch (err) {
    await c.query("ROLLBACK");
    throw err;
  } finally {
    c.release();
  }
}

// Provide a default export too, so you can import whichever way you prefer.
export default withIdempotency;
