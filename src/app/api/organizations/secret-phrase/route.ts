import { NextRequest, NextResponse } from "next/server";
import { pgPool as pool } from "@/lib/db";
import { getContext } from "@/lib/context";
import crypto from "crypto";

const ENC_KEY_B64 = process.env.ENCRYPTION_KEY || "";
const ENC_IV_B64 = process.env.ENCRYPTION_IV || "";

function getKeyIv() {
  const key = Buffer.from(ENC_KEY_B64, "base64");
  const iv = Buffer.from(ENC_IV_B64, "base64");
  if (key.length !== 32) {
    throw new Error("ENCRYPTION_KEY must decode to 32 bytes");
  }
  if (iv.length !== 16) {
    throw new Error("ENCRYPTION_IV must decode to 16 bytes");
  }
  return { key, iv };
}

function encryptSecret(plain: string) {
  const { key, iv } = getKeyIv();
  const cipher = crypto.createCipheriv("aes-256-cbc", key, iv);
  let enc = cipher.update(plain, "utf8", "base64");
  enc += cipher.final("base64");
  return enc;
}

export async function POST(req: NextRequest) {
  try {
    // session/org context (uses your existing helper)
    const ctx = await getContext(req);
    if (ctx instanceof NextResponse) return ctx; // propagated error
    const { organizationId } = ctx;

    const { secretPhrase } = (await req.json()) as { secretPhrase?: string };
    if (!secretPhrase) {
      return NextResponse.json(
        { error: "Missing secret phrase" },
        { status: 400 }
      );
    }

    const encrypted = encryptSecret(secretPhrase);
    await pool.query(
      `UPDATE "organization" SET "encryptedSecret" = $1 WHERE id = $2`,
      [encrypted, organizationId]
    );

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[POST /api/organizations/secret-phrase] error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}