export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { pgPool as pool } from "@/lib/db";
import { getContext } from "@/lib/context";
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
  let out = cipher.update(plain, "utf8", "base64");
  out += cipher.final("base64");
  return out;
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await getContext(req);
    if (ctx instanceof NextResponse) return ctx;
    const { userId, organizationId } = ctx;

    if (!userId || !organizationId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

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

    // Validate ticket (code row) belongs to this user+org and not used/expired
    const { rows } = await pool.query(
      `SELECT id, "userId", "organizationId", "expiresAt", used
         FROM "orgSecretCode"
        WHERE id = $1`,
      [ticketId]
    );
    if (!rows.length) {
      return NextResponse.json({ error: "Invalid ticket" }, { status: 400 });
    }

    const t = rows[0] as {
      id: string;
      userId: string;
      organizationId: string;
      expiresAt: string;
      used: boolean;
    };

    if (t.userId !== userId || t.organizationId !== organizationId) {
      return NextResponse.json({ error: "Ticket does not match session" }, { status: 403 });
    }
    if (t.used) {
      return NextResponse.json({ error: "Ticket already used" }, { status: 400 });
    }
    if (Date.now() > new Date(t.expiresAt).getTime()) {
      return NextResponse.json({ error: "Ticket expired" }, { status: 400 });
    }

    // Encrypt and store on organization
    const encrypted = encryptSecret(secretPhrase);
    await pool.query(
      `UPDATE "organization" SET "encryptedSecret" = $1 WHERE id = $2`,
      [encrypted, organizationId]
    );

    // Invalidate ticket
    await pool.query(
      `UPDATE "orgSecretCode" SET used = true, "usedAt" = $2 WHERE id = $1`,
      [ticketId, new Date()]
    );

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[POST /api/organizations/secret-phrase] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
