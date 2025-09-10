import { NextRequest, NextResponse } from "next/server";
import { pgPool as pool } from "@/lib/db";
import { v4 as uuidv4 } from "uuid";
import { getContext } from "@/lib/context";
import crypto from "crypto";
import { z } from "zod";

/* ---------- encryption helpers (same as before) ---------- */
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

/* ───────── POST: create (or replace) client secret phrase ───────── */
export async function POST(req: NextRequest, { params }: Params) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { organizationId } = ctx;
  const { id: userId } = await params;

  try {
    const { phrase } = bodySchema.parse(await req.json());

    // Find client by Telegram userId
    const client = await getClientByTelegramId(userId, organizationId);
    if (!client) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }
    if (client.secretPhraseEnabled === false) {
      return NextResponse.json({ error: "Secret phrase is disabled for this client" }, { status: 403 });
    }

    // Encrypt & upsert
    const encrypted = encryptSecretNode(phrase);

    // Check if phrase already exists
    const checkSql = `SELECT id FROM "clientSecretPhrase" WHERE "clientId" = $1 LIMIT 1`;
    const checkRes = await pool.query(checkSql, [client.id]);

    if (checkRes.rowCount) {
      const updSql = `
        UPDATE "clientSecretPhrase"
           SET phrase = $1, "updatedAt" = NOW()
         WHERE "clientId" = $2
       RETURNING id, "clientId", "createdAt", "updatedAt"
      `;
      const { rows } = await pool.query(updSql, [encrypted, client.id]);
      return NextResponse.json(rows[0], { status: 200 });
    } else {
      const insSql = `
        INSERT INTO "clientSecretPhrase" (id, "clientId", phrase, "createdAt", "updatedAt")
        VALUES ($1, $2, $3, NOW(), NOW())
        RETURNING id, "clientId", "createdAt", "updatedAt"
      `;
      const id = uuidv4();
      const { rows } = await pool.query(insSql, [id, client.id, encrypted]);
      return NextResponse.json(rows[0], { status: 201 });
    }
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.errors }, { status: 400 });
    }
    console.error("[POST /api/clients/secret-phrase/[id]] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/* ───────── PATCH: update phrase for client ───────── */
export async function PATCH(req: NextRequest, { params }: Params) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { organizationId } = ctx;
  const { id: userId } = await params;

  try {
    const { phrase } = bodySchema.parse(await req.json());

    // Find client by Telegram userId
    const client = await getClientByTelegramId(userId, organizationId);
    if (!client) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }
    if (client.secretPhraseEnabled === false) {
      return NextResponse.json({ error: "Secret phrase is disabled for this client" }, { status: 403 });
    }

    const encrypted = encryptSecretNode(phrase);

    // Ensure phrase row exists
    const checkSql = `SELECT id FROM "clientSecretPhrase" WHERE "clientId" = $1 LIMIT 1`;
    const checkRes = await pool.query(checkSql, [client.id]);

    if (!checkRes.rowCount) {
      const insSql = `
        INSERT INTO "clientSecretPhrase" (id, "clientId", phrase, "createdAt", "updatedAt")
        VALUES ($1, $2, $3, NOW(), NOW())
        RETURNING id, "clientId", "createdAt", "updatedAt"
      `;
      const id = uuidv4();
      const { rows } = await pool.query(insSql, [id, client.id, encrypted]);
      return NextResponse.json(rows[0], { status: 201 });
    }

    const updSql = `
      UPDATE "clientSecretPhrase"
         SET phrase = $1, "updatedAt" = NOW()
       WHERE "clientId" = $2
     RETURNING id, "clientId", "createdAt", "updatedAt"
    `;
    const { rows } = await pool.query(updSql, [encrypted, client.id]);
    return NextResponse.json(rows[0], { status: 200 });
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.errors }, { status: 400 });
    }
    console.error("[PATCH /api/clients/secret-phrase/[id]] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}


/* ───────── DELETE: clear phrase for client (reset) ───────── */
export async function DELETE(req: NextRequest, { params }: Params) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { organizationId } = ctx;
  const { id: userId } = await params;

  try {
    // Find client by Telegram userId
    const client = await getClientByTelegramId(userId, organizationId);
    if (!client) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }

    // Remove any existing phrase row
    const delSql = `DELETE FROM "clientSecretPhrase" WHERE "clientId" = $1`;
    const result = await pool.query(delSql, [client.id]);

    // 200 with a simple payload; you could also return 204 with empty body
    return NextResponse.json(
      { ok: true, deleted: (result.rowCount ?? 0) > 0 },
      { status: 200 },
    );
  } catch (err: any) {
    console.error("[DELETE /api/clients/secret-phrase/[id]] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
