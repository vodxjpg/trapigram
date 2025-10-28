// src/lib/idempotency.ts
import { NextRequest, NextResponse } from "next/server";
import { pgPool as pool } from "@/lib/db";

/**
 * Exec returns either {status, body} OR a NextResponse.
 * We always return a NextResponse.
 *
 * NEVER call r.json() or r.clone() on a NextResponse you intend to return.
 * Read the original body once (text), persist a JSON-ish shape, and
 * return a brand-new NextResponse with the same body & headers.
 */
export async function withIdempotency(
  req: NextRequest,
  exec: () => Promise<{ status: number; body: any } | NextResponse>
): Promise<NextResponse> {
  const key = req.headers.get("Idempotency-Key");

  // Fast-path: no idempotency
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
      // replay
      if (e?.code === "23505") {
        const { rows } = await c.query(
          `SELECT status, response FROM idempotency WHERE key=$1`,
          [key]
        );
        await c.query("COMMIT");
        if (rows[0]) return NextResponse.json(rows[0].response, { status: rows[0].status });
        return NextResponse.json({ error: "Idempotency replay but no record" }, { status: 409 });
      }
      // table missing → best-effort passthrough
      if (e?.code === "42P01") {
        await c.query("ROLLBACK");
        const r = await exec();
        return r instanceof NextResponse ? r : NextResponse.json(r.body, { status: r.status });
      }
      throw e;
    }

    const r = await exec();

    // Case A: route returned a NextResponse (possibly streaming)
    if (r instanceof NextResponse) {
      const status = r.status;
      const headers = new Headers(r.headers);

      // Read & persist once
      let bodyText = "";
      let storedBody: any = null;
      try {
        bodyText = await r.text(); // consumes the original body
        const ct = (headers.get("content-type") || "").toLowerCase();
        if (ct.includes("application/json")) {
          try { storedBody = JSON.parse(bodyText); } catch { storedBody = null; }
        } else {
          storedBody = { text: bodyText.slice(0, 4096) };
        }
      } catch {
        storedBody = null;
      }

      await c.query(
        `UPDATE idempotency
           SET status=$2, response=$3, "updatedAt"=NOW()
         WHERE key=$1`,
        [key, status, storedBody]
      );
      await c.query("COMMIT");

      // Re-emit a fresh response (no locked stream)
      headers.delete("content-length");
      return new NextResponse(bodyText, { status, headers });
    }

    // Case B: plain object form
    await c.query(
      `UPDATE idempotency
         SET status=$2, response=$3, "updatedAt"=NOW()
       WHERE key=$1`,
      [key, r.status, r.body ?? null]
    );
    await c.query("COMMIT");
    return NextResponse.json(r.body ?? null, { status: r.status });
  } catch (err) {
    await c.query("ROLLBACK");
    throw err;
  } finally {
    c.release();
  }
}

export default withIdempotency;
