// /home/zodx/Desktop/trapigram/src/app/api/internal/organization/verify-secret/route.ts
import { NextRequest, NextResponse } from "next/server";
import { Pool } from "pg";
import { auth } from "@/lib/auth";
import crypto from "crypto";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET as string;
const ENC_KEY_B64 = process.env.ENCRYPTION_KEY || "";
const ENC_IV_B64 = process.env.ENCRYPTION_IV || "";

function getEncryptionKeyAndIv(): { key: Buffer; iv: Buffer } {
  const key = Buffer.from(ENC_KEY_B64, "base64");
  const iv = Buffer.from(ENC_IV_B64, "base64");
  if (!ENC_KEY_B64 || !ENC_IV_B64) {
    throw new Error("ENCRYPTION_KEY or ENCRYPTION_IV not set in environment");
  }
  if (key.length !== 32) {
    throw new Error(`Invalid ENCRYPTION_KEY: must decode to 32 bytes, got ${key.length}`);
  }
  if (iv.length !== 16) {
    throw new Error(`Invalid ENCRYPTION_IV: must decode to 16 bytes, got ${iv.length}`);
  }
  return { key, iv };
}

function decryptSecret(encryptedText: string): string {
  const { key, iv } = getEncryptionKeyAndIv();
  const decipher = crypto.createDecipheriv("aes-256-cbc", key, iv);
  let decrypted = decipher.update(encryptedText, "base64", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}

export async function POST(req: NextRequest) {
  try {
    const secret = req.headers.get("x-internal-secret");
    if (secret !== INTERNAL_API_SECRET) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    const session = await auth.api.getSession({ headers: req.headers });
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { organizationId, secretPhrase } = await req.json();
    if (!organizationId || !secretPhrase) {
      return NextResponse.json({ error: "Missing organization ID or secret phrase" }, { status: 400 });
    }

    const { rows } = await pool.query(
      `SELECT "encryptedSecret" FROM organization WHERE id = $1`,
      [organizationId]
    );
    if (rows.length === 0) {
      return NextResponse.json({ error: "Organization not found" }, { status: 404 });
    }

    const storedEncryptedSecret = rows[0].encryptedSecret;
    if (!storedEncryptedSecret) {
      return NextResponse.json({ error: "No secret phrase set" }, { status: 400 });
    }

    const storedSecret = decryptSecret(storedEncryptedSecret);
    const verified = secretPhrase === storedSecret;
    return NextResponse.json({ verified }, { status: 200 });
  } catch (error) {
    console.error("[POST /api/internal/organization/verify-secret] Error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}