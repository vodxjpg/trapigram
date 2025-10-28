import { NextRequest, NextResponse } from "next/server";
import { pgPool as pool } from "@/lib/db";

/**
 * Exec returns either {status, body} OR a NextResponse.
 * We always return a NextResponse.
 *
 * IMPORTANT:
 * - Do NOT use response.clone() here. Tee-ing streams can make the original
 *   body "locked" for Next's response piping.
 * - Instead, read the *original* body once (text), persist a JSON/object form,
 *   then return a brand-new NextResponse with the same body and headers.
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
        `INSERT INTO idempotency(key, method, path, "createdAt") VALUES ($1,$2,$3,NOW())`,
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
        await c.query("ROLLBACK");
        const r = await exec();
        return r instanceof NextResponse ? r : NextResponse.json(r.body, { status: r.status });
      }
      throw e;
    }

    const result = await exec();

    // Case 1: The route returned a NextResponse (streaming or not).
    if (result instanceof NextResponse) {
      const status = result.status;
      // Copy headers BEFORE consuming body.
      const headers = new Headers(result.headers);

      // Consume body once and persist safely.
      let bodyText = "";
      let storedBody: any = null;
      try {
        bodyText = await result.text(); // consume original body
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

      // Re-emit a fresh response with the same body & headers.
      // Remove content-length to let Next recalc it for our new body.
      headers.delete("content-length");
      return new NextResponse(bodyText, { status, headers });
    }

    // Case 2: Plain object form {status, body}
    const status = result.status;
    const persisted = result.body ?? null;

    await c.query(
      `UPDATE idempotency
         SET status=$2, response=$3, "updatedAt"=NOW()
       WHERE key=$1`,
      [key, status, persisted]
    );
    await c.query("COMMIT");

    return NextResponse.json(persisted, { status });
  } catch (err) {
    await c.query("ROLLBACK");
    throw err;
  } finally {
    c.release();
  }
}

export default withIdempotency;
