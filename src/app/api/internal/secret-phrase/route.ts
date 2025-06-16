// File: src/app/api/internal/secret-phrase/route.ts
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import crypto from "crypto";

const ENC_KEY_B64 = process.env.ENCRYPTION_KEY || "";
const ENC_IV_B64 = process.env.ENCRYPTION_IV || "";
const INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET;

function getKeyIv() {
  const key = Buffer.from(ENC_KEY_B64, "base64");
  const iv = Buffer.from(ENC_IV_B64, "base64");
  if (key.length !== 32 || iv.length !== 16) {
    throw new Error("Invalid ENCRYPTION_KEY or ENCRYPTION_IV length");
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
    // 1. Internal secret check
    const secret = req.headers.get("x-internal-secret");
    if (secret !== INTERNAL_API_SECRET) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    // 2. Parse client-sent secretPhrase
    const { secretPhrase } = (await req.json()) as { secretPhrase?: string };
    if (!secretPhrase) {
      return NextResponse.json(
        { error: "Missing secretPhrase" },
        { status: 400 }
      );
    }

    // 3. Encrypt and persist
    const encrypted = encryptSecret(secretPhrase);
    await db
      .updateTable("organization")
      .set({ encryptedSecret: encrypted })
      .where("id", "=", /* your org ID here? or pass via body */ req.headers.get("x-organization-id")!)
      .execute();

    return NextResponse.json(
      { message: "Secret phrase stored successfully" },
      { status: 200 }
    );
  } catch (error) {
    console.error("[POST /api/internal/secret-phrase] error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
