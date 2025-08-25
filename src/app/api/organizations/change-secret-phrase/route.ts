 // src/app/api/organizations/change-secret-phrase/route.ts
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { pgPool as pool } from "@/lib/db";
import { getContext } from "@/lib/context";
import crypto from "crypto";

// AES-256-CBC key/iv used elsewhere (same env vars as onboarding)
const ENC_KEY_B64 = process.env.ENCRYPTION_KEY || "";
const ENC_IV_B64  = process.env.ENCRYPTION_IV  || "";

function getKeyIv() {
  const key = Buffer.from(ENC_KEY_B64, "base64");
  const iv  = Buffer.from(ENC_IV_B64, "base64");
  if (key.length !== 32) {
    throw new Error("ENCRYPTION_KEY must decode to 32 bytes (base64)");
  }
  if (iv.length !== 16) {
    throw new Error("ENCRYPTION_IV must decode to 16 bytes (base64)");
  }
  return { key, iv };
}

function encryptSecret(plain: string) {
  const { key, iv } = getKeyIv();
  const cipher = crypto.createCipheriv("aes-256-cbc", key, iv);
  let out = cipher.update(plain, "utf8", "base64");
  out = cipher.final("base64");
  return out;
}

async function assertOwner(orgId: string, userId: string) {
  const { rowCount } = await pool.query(
    `SELECT 1 FROM member
     WHERE "organizationId" = $1 AND "userId" = $2 AND role = 'owner'`,
    [orgId, userId]
  );
  if (!rowCount) {
    throw new Error("Only the organization owner may change the secret phrase");
  }
}

export async function POST(req: NextRequest) {
  // cookie auth  active organization from your existing context helper
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { organizationId, userId } = ctx;

  try {
    await assertOwner(organizationId, userId);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 403 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const secretPhrase: string | undefined = body?.secretPhrase;
  if (!secretPhrase || typeof secretPhrase !== "string") {
    return NextResponse.json(
      { error: "secretPhrase is required" },
      { status: 400 }
    );
  }

  try {
    const encrypted = encryptSecret(secretPhrase);
    await pool.query(
      `UPDATE organization
         SET "encryptedSecret" = $1
       WHERE id = $2`,
      [encrypted, organizationId]
    );
    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error("[change-secret-phrase] DB error:", err);
    return NextResponse.json(
      { error: "Failed to update secret phrase" },
      { status: 500 }
    );
  }
}
