// src/app/api/organizations/verify-secret/route.ts
import { NextRequest, NextResponse } from "next/server";
import { pgPool as pool } from "@/lib/db";;
import { getContext } from "@/lib/context";
import crypto from "crypto";


const ENC_KEY_B64 = process.env.ENCRYPTION_KEY!;
const ENC_IV_B64 = process.env.ENCRYPTION_IV!;

function getEncryptionKeyAndIv(): { key: Buffer; iv: Buffer } {
  const key = Buffer.from(ENC_KEY_B64, "base64");
  const iv = Buffer.from(ENC_IV_B64, "base64");
  if (key.length !== 32) throw new Error("ENCRYPTION_KEY must be 32 bytes");
  if (iv.length !== 16) throw new Error("ENCRYPTION_IV must be 16 bytes");
  return { key, iv };
}

function decryptSecret(encrypted: string): string {
  const { key, iv } = getEncryptionKeyAndIv();
  const decipher = crypto.createDecipheriv("aes-256-cbc", key, iv);
  let out = decipher.update(encrypted, "base64", "utf8");
  out += decipher.final("utf8");
  return out;
}

export async function POST(req: NextRequest) {
  // 1) session-cookie auth & get org
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { organizationId: orgId } = ctx;

  // 2) parse body (only need secretPhrase)
  const { secretPhrase } = await req.json();
  if (!secretPhrase) {
    return NextResponse.json(
      { error: "Missing secret phrase" },
      { status: 400 }
    );
  }

  // 3) lookup encryptedSecret from org
  const { rows } = await pool.query(
    `SELECT "encryptedSecret" FROM organization WHERE id = $1`,
    [orgId]
  );
  if (rows.length === 0) {
    return NextResponse.json(
      { error: "Organization not found" },
      { status: 404 }
    );
  }

  const storedEncrypted = rows[0].encryptedSecret;
  if (!storedEncrypted) {
    return NextResponse.json(
      { error: "No secret set" },
      { status: 400 }
    );
  }

  // 4) decrypt & compare
  const stored = decryptSecret(storedEncrypted);
  const verified = secretPhrase === stored;
  return NextResponse.json({ verified });
}
