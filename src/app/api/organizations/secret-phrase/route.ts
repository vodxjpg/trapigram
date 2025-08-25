import { NextRequest, NextResponse } from "next/server";
import { pgPool as pool } from "@/lib/db";
import { getContext } from "@/lib/context";
import { auth } from "@/lib/auth";
import crypto from "crypto";

const ENC_KEY_B64 = process.env.ENCRYPTION_KEY || "";
const ENC_IV_B64 = process.env.ENCRYPTION_IV || "";

function getKeyIv() {
  const key = Buffer.from(ENC_KEY_B64, "base64");
  const iv = Buffer.from(ENC_IV_B64, "base64");
  if (key.length !== 32) throw new Error("ENCRYPTION_KEY must decode to 32 bytes");
  if (iv.length !== 16) throw new Error("ENCRYPTION_IV must decode to 16 bytes");
  return { key, iv };
}

function encryptSecret(plain: string) {
  const { key, iv } = getKeyIv();
  const cipher = crypto.createCipheriv("aes-256-cbc", key, iv);
  let enc = cipher.update(plain, "utf8", "base64");
  enc += cipher.final("base64");
  return enc;
}

/**
 * POST /api/organizations/secret-phrase
 * Body: { secretPhrase: string, ticketId: string }
 * Requires a previously verified ticketId (issued by /change-secret/verify-code).
 */
export async function POST(req: NextRequest) {
  try {
    // session/org context
    const session = await auth.api.getSession({ headers: req.headers });
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const ctx = await getContext(req);
    if (ctx instanceof NextResponse) return ctx;
    const { organizationId } = ctx;
    const userId = session.user.id;

    const { secretPhrase, ticketId } = (await req.json()) as {
      secretPhrase?: string;
      ticketId?: string;
    };

    if (!secretPhrase) {
      return NextResponse.json({ error: "Missing secret phrase" }, { status: 400 });
    }
    if (!ticketId) {
      return NextResponse.json({ error: "Missing verification ticket" }, { status: 400 });
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // Validate ticket (must be verified, not consumed, not expired)
      const ticketRes = await client.query(
        `SELECT "id", "expiresAt"
           FROM "orgSecretCode"
          WHERE "ticketId" = $1
            AND "organizationId" = $2
            AND "userId" = $3
            AND "verifiedAt" IS NOT NULL
            AND "consumedAt" IS NULL
          ORDER BY "createdAt" DESC
          LIMIT 1
          FOR UPDATE`,
        [ticketId, organizationId, userId]
      );

      if (ticketRes.rows.length === 0) {
        await client.query("ROLLBACK");
        return NextResponse.json({ error: "Invalid or used ticket" }, { status: 400 });
      }

      const { expiresAt } = ticketRes.rows[0];
      if (new Date(expiresAt).getTime() < Date.now()) {
        await client.query("ROLLBACK");
        return NextResponse.json({ error: "Ticket expired" }, { status: 400 });
      }

      const encrypted = encryptSecret(secretPhrase);

      // Update organization secret
      await client.query(
        `UPDATE "organization" SET "encryptedSecret" = $1 WHERE id = $2`,
        [encrypted, organizationId]
      );

      // Consume ticket
      await client.query(
        `UPDATE "orgSecretCode" SET "consumedAt" = now() WHERE "ticketId" = $1`,
        [ticketId]
      );

      await client.query("COMMIT");
      return NextResponse.json({ ok: true });
    } catch (e) {
      await client.query("ROLLBACK");
      console.error("[POST /api/organizations/secret-phrase] tx error:", e);
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    } finally {
      client.release();
    }
  } catch (err) {
    console.error("[POST /api/organizations/secret-phrase] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
