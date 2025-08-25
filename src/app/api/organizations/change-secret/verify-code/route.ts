import { NextRequest, NextResponse } from "next/server";
import { pgPool as pool } from "@/lib/db";
import { getContext } from "@/lib/context";
import { auth } from "@/lib/auth";
import crypto from "crypto";
import { v4 as uuidv4 } from "uuid";

const HMAC_SECRET =
  process.env.SECRET_CODE_SALT || process.env.ENCRYPTION_KEY || "fallback-secret";
const MAX_ATTEMPTS = 5;

function hashCode(code: string, userId: string, organizationId: string) {
  return crypto
    .createHmac("sha256", HMAC_SECRET)
    .update(`${code}:${userId}:${organizationId}`)
    .digest("hex");
}

export async function POST(req: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: req.headers });
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const ctx = await getContext(req);
    if (ctx instanceof NextResponse) return ctx;
    const { organizationId } = ctx;
    const userId = session.user.id;

    const { code } = (await req.json()) as { code?: string };
    if (!code || !/^\d{6}$/.test(code)) {
      return NextResponse.json({ error: "Invalid code" }, { status: 400 });
    }
    const codeHash = hashCode(code, userId, organizationId);

    // latest pending record
    const { rows } = await pool.query(
      `SELECT id, attempts, expires_at, consumed_at, verified_at
         FROM org_secret_code
        WHERE "organizationId" = $1
          AND "userId" = $2
          AND consumed_at IS NULL
        ORDER BY created_at DESC
        LIMIT 1`,
      [organizationId, userId]
    );
    if (rows.length === 0) {
      return NextResponse.json({ error: "Code not found or expired" }, { status: 400 });
    }
    const rec = rows[0];

    if (rec.consumed_at) {
      return NextResponse.json({ error: "Code already used" }, { status: 400 });
    }
    if (new Date(rec.expires_at).getTime() < Date.now()) {
      return NextResponse.json({ error: "Code expired" }, { status: 400 });
    }
    if (rec.attempts >= MAX_ATTEMPTS) {
      return NextResponse.json({ error: "Too many attempts" }, { status: 429 });
    }

    // increment attempts
    await pool.query(`UPDATE org_secret_code SET attempts = attempts + 1 WHERE id = $1`, [rec.id]);

    // compare hash
    const match = await pool.query(
      `SELECT 1 FROM org_secret_code WHERE id = $1 AND code_hash = $2`,
      [rec.id, codeHash]
    );
    if (match.rowCount === 0) {
      return NextResponse.json({ error: "Invalid code" }, { status: 400 });
    }

    const ticketId = uuidv4();
    await pool.query(
      `UPDATE org_secret_code
          SET verified_at = now(),
              ticket_id  = $2
        WHERE id = $1`,
      [rec.id, ticketId]
    );

    return NextResponse.json({ ok: true, ticketId });
  } catch (err) {
    console.error("[POST /api/organizations/change-secret/verify-code] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
