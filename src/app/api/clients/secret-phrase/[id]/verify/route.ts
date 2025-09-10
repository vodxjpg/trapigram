//src/app/api/clients/secret-phrase/[id]/verify/route.ts
import { NextRequest, NextResponse } from "next/server";
import { pgPool as pool } from "@/lib/db";
import { getContext } from "@/lib/context";
import { z } from "zod";
import crypto from "crypto";

/* ---------- shared helpers (copy from sibling route) ---------- */
const ENC_KEY_B64 = process.env.ENCRYPTION_KEY || "";
const ENC_IV_B64  = process.env.ENCRYPTION_IV   || "";

function getEncryptionKeyAndIv(): { key: Buffer; iv: Buffer } {
  const key = Buffer.from(ENC_KEY_B64, "base64");
  const iv  = Buffer.from(ENC_IV_B64,  "base64");
  if (!ENC_KEY_B64 || !ENC_IV_B64) throw new Error("ENCRYPTION_KEY or ENCRYPTION_IV not set");
  if (key.length !== 32) throw new Error(`Invalid ENCRYPTION_KEY length: ${key.length}`);
  if (iv.length  !== 16) throw new Error(`Invalid ENCRYPTION_IV length: ${iv.length}`);
  return { key, iv };
}

function encryptSecretNode(plain: string): string {
  const { key, iv } = getEncryptionKeyAndIv();
  const cipher = crypto.createCipheriv("aes-256-cbc", key, iv);
  let encrypted = cipher.update(plain, "utf8", "base64");
  encrypted += cipher.final("base64");
  return encrypted;
}

async function getClientByTelegramId(userId: string, organizationId: string) {
  const sql = `
    SELECT id, "secretPhraseEnabled"
      FROM public.clients
     WHERE "userId" = $1 AND "organizationId" = $2
     LIMIT 1
  `;
  const { rows } = await pool.query(sql, [userId, organizationId]);
  return rows[0] || null;
}

const bodySchema = z.object({ phrase: z.string().min(1) });

type Params = { params: Promise<{ id: string }> };

/* ───────── POST: verify (do NOT overwrite), bump updatedAt on success ───────── */
export async function POST(req: NextRequest, { params }: Params) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { organizationId } = ctx;
  const { id: userId } = await params;

  try {
    const { phrase } = bodySchema.parse(await req.json());
    const client = await getClientByTelegramId(userId, organizationId);
    if (!client) return NextResponse.json({ ok: false }, { status: 401 });
    if (client.secretPhraseEnabled === false) {
      return NextResponse.json({ ok: false, error: "disabled" }, { status: 403 });
    }

    const enc = encryptSecretNode(phrase);
    const row = await pool.query(
      `SELECT id FROM "clientSecretPhrase" WHERE "clientId" = $1 AND phrase = $2 LIMIT 1`,
      [client.id, enc],
    );
    if (!row.rowCount) return NextResponse.json({ ok: false }, { status: 401 });

    await pool.query(
      `UPDATE "clientSecretPhrase" SET "updatedAt" = NOW() WHERE id = $1`,
      [row.rows[0].id],
    );
    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ ok: false, error: err.errors }, { status: 400 });
    }
    console.error("[POST /api/clients/secret-phrase/[id]/verify] error:", err);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}
