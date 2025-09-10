import { NextRequest, NextResponse } from "next/server";
import { pgPool as pool } from "@/lib/db";
import { getContext } from "@/lib/context";
import crypto from "crypto";
import { z } from "zod";

/* ---------- encryption helpers (same as in [id]/route.ts) ---------- */
const ENC_KEY_B64 = process.env.ENCRYPTION_KEY || "";
const ENC_IV_B64  = process.env.ENCRYPTION_IV   || "";

function getEncryptionKeyAndIv(): { key: Buffer; iv: Buffer } {
  const key = Buffer.from(ENC_KEY_B64, "base64");
  const iv  = Buffer.from(ENC_IV_B64,  "base64");
  if (!ENC_KEY_B64 || !ENC_IV_B64) {
    throw new Error("ENCRYPTION_KEY or ENCRYPTION_IV not set in environment");
  }
  if (key.length !== 32) throw new Error(`Invalid ENCRYPTION_KEY: expected 32 bytes, got ${key.length}`);
  if (iv.length  !== 16) throw new Error(`Invalid ENCRYPTION_IV: expected 16 bytes, got ${iv.length}`);
  return { key, iv };
}

function encryptSecretNode(plain: string): string {
  const { key, iv } = getEncryptionKeyAndIv();
  const cipher = crypto.createCipheriv("aes-256-cbc", key, iv);
  let encrypted = cipher.update(plain, "utf8", "base64");
  encrypted += cipher.final("base64");
  return encrypted;
}

/* ---------- validation ---------- */
const bodySchema = z.object({
  phrase: z.string().min(1, "Phrase is required"),
});

type Params = { params: Promise<{ id: string }> }; // id = Telegram userId

/* ---------- helpers ---------- */
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

/* ───────── POST: verify client secret phrase (no overwrite) ─────────
   Returns 200 always with { ok: true|false } when client & feature exist.
   On success: bumps updatedAt to “now” so reverify timers reset.          */
export async function POST(req: NextRequest, { params }: Params) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { organizationId } = ctx;
  const { id: userId } = await params;

  try {
    const { phrase } = bodySchema.parse(await req.json());

    // 1) resolve client
    const client = await getClientByTelegramId(userId, organizationId);
    if (!client) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }
    if (client.secretPhraseEnabled === false) {
      return NextResponse.json({ error: "Secret phrase disabled" }, { status: 403 });
    }

    // 2) fetch stored encrypted phrase
    const rowSql = `SELECT id, phrase FROM "clientSecretPhrase" WHERE "clientId" = $1 LIMIT 1`;
    const rowRes = await pool.query(rowSql, [client.id]);
    if (!rowRes.rowCount) {
      // no phrase saved yet
      return NextResponse.json({ ok: false, errorCode: "NO_PHRASE" }, { status: 200 });
    }

    // 3) compare deterministically-encrypted values (same key+IV)
    const candidate = encryptSecretNode(phrase);
    const { id: cspId, phrase: stored } = rowRes.rows[0] as { id: string; phrase: string };
    const ok = candidate === stored;

    // 4) if match, bump updatedAt so reverifyAfterDays countdown resets
    if (ok) {
      const upd = `UPDATE "clientSecretPhrase" SET "updatedAt" = NOW() WHERE id = $1`;
      await pool.query(upd, [cspId]);
    }

    return NextResponse.json({ ok }, { status: 200 });
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.errors }, { status: 400 });
    }
    console.error("[POST /api/clients/secret-phrase/[id]/verify] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
