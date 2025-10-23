// src/app/api/clients/secret-phrase/[id]/route.ts
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { pgPool as pool } from "@/lib/db";
import { v4 as uuidv4 } from "uuid";
import { getContext } from "@/lib/context";
import crypto from "crypto";
import { z } from "zod";

/* ---------- encryption helpers ---------- */
const ENC_KEY_B64 = process.env.ENCRYPTION_KEY || "";
const ENC_IV_B64 = process.env.ENCRYPTION_IV || "";

function getEncryptionKeyAndIv(): { key: Buffer; iv: Buffer } {
  const key = Buffer.from(ENC_KEY_B64, "base64");
  const iv = Buffer.from(ENC_IV_B64, "base64");
  if (!ENC_KEY_B64 || !ENC_IV_B64) {
    throw new Error("ENCRYPTION_KEY or ENCRYPTION_IV not set in environment");
  }
  if (key.length !== 32) throw new Error(`Invalid ENCRYPTION_KEY: expected 32 bytes, got ${key.length}`);
  if (iv.length !== 16) throw new Error(`Invalid ENCRYPTION_IV: expected 16 bytes, got ${iv.length}`);
  return { key, iv };
}

function encryptSecretNode(plain: string): string {
  const { key, iv } = getEncryptionKeyAndIv();
  const cipher = crypto.createCipheriv("aes-256-cbc", key, iv);
  return cipher.update(plain, "utf8", "base64") + cipher.final("base64");
}

/* ---------- validation ---------- */
const bodySchema = z.object({
  phrase: z.string().min(1, "Phrase is required"),
});

/* ---------- types ---------- */
// Next 15/16: params is a Promise
type Ctx = { params: Promise<{ id: string }> }; // id = Telegram userId

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

/* ───────── GET: existence + updatedAt ───────── */
export async function GET(req: NextRequest, ctx: Ctx) {
  const session = await getContext(req);
  if (session instanceof NextResponse) return session;
  const { organizationId } = session;
  const { id: userId } = await ctx.params;

  try {
    const client = await getClientByTelegramId(userId, organizationId);
    if (!client) {
      return NextResponse.json({ hasPhrase: false, updatedAt: null }, { status: 200 });
    }

    const row = await pool.query(
      `SELECT "updatedAt" FROM "clientSecretPhrase" WHERE "clientId" = $1 LIMIT 1`,
      [client.id],
    );

    if (!row.rowCount) {
      return NextResponse.json({ hasPhrase: false, updatedAt: null }, { status: 200 });
    }
    return NextResponse.json({ hasPhrase: true, updatedAt: row.rows[0].updatedAt }, { status: 200 });
  } catch (err) {
    console.error("[GET /api/clients/secret-phrase/[id]] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/* ───────── POST: create (or replace) client secret phrase ───────── */
export async function POST(req: NextRequest, ctx: Ctx) {
  const session = await getContext(req);
  if (session instanceof NextResponse) return session;
  const { organizationId } = session;
  const { id: userId } = await ctx.params;

  try {
    const { phrase } = bodySchema.parse(await req.json());

    const client = await getClientByTelegramId(userId, organizationId);
    if (!client) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }
    if (client.secretPhraseEnabled === false) {
      return NextResponse.json({ error: "Secret phrase is disabled for this client" }, { status: 403 });
    }

    const encrypted = encryptSecretNode(phrase);

    const checkSql = `SELECT id FROM "clientSecretPhrase" WHERE "clientId" = $1 LIMIT 1`;
    const checkRes = await pool.query(checkSql, [client.id]);

    let row;
    if (checkRes.rowCount) {
      const updSql = `
        UPDATE "clientSecretPhrase"
           SET phrase = $1, "updatedAt" = NOW()
         WHERE "clientId" = $2
       RETURNING id, "clientId", "createdAt", "updatedAt"
      `;
      const res = await pool.query(updSql, [encrypted, client.id]);
      row = res.rows[0];
    } else {
      const insSql = `
        INSERT INTO "clientSecretPhrase" (id, "clientId", phrase, "createdAt", "updatedAt")
        VALUES ($1, $2, $3, NOW(), NOW())
        RETURNING id, "clientId", "createdAt", "updatedAt"
      `;
      const id = uuidv4();
      const res = await pool.query(insSql, [id, client.id, encrypted]);
      row = res.rows[0];
    }

    // clear force flag so the bot stops re-prompting
    await pool.query(
      `UPDATE public.clients
          SET "secretPhraseForceAt" = NULL,
              "updatedAt" = NOW()
        WHERE id = $1`,
      [client.id],
    );

    return NextResponse.json(row, { status: checkRes.rowCount ? 200 : 201 });
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.errors }, { status: 400 });
    }
    console.error("[POST /api/clients/secret-phrase/[id]] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/* ───────── PATCH: update phrase ───────── */
export async function PATCH(req: NextRequest, ctx: Ctx) {
  const session = await getContext(req);
  if (session instanceof NextResponse) return session;
  const { organizationId } = session;
  const { id: userId } = await ctx.params;

  try {
    const { phrase } = bodySchema.parse(await req.json());

    const client = await getClientByTelegramId(userId, organizationId);
    if (!client) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }
    if (client.secretPhraseEnabled === false) {
      return NextResponse.json({ error: "Secret phrase is disabled for this client" }, { status: 403 });
    }

    const encrypted = encryptSecretNode(phrase);

    // upsert
    const checkSql = `SELECT id FROM "clientSecretPhrase" WHERE "clientId" = $1 LIMIT 1`;
    const checkRes = await pool.query(checkSql, [client.id]);

    let row;
    if (!checkRes.rowCount) {
      const insSql = `
        INSERT INTO "clientSecretPhrase" (id, "clientId", phrase, "createdAt", "updatedAt")
        VALUES ($1, $2, $3, NOW(), NOW())
        RETURNING id, "clientId", "createdAt", "updatedAt"
      `;
      const id = uuidv4();
      const res = await pool.query(insSql, [id, client.id, encrypted]);
      row = res.rows[0];
    } else {
      const updSql = `
        UPDATE "clientSecretPhrase"
           SET phrase = $1, "updatedAt" = NOW()
         WHERE "clientId" = $2
       RETURNING id, "clientId", "createdAt", "updatedAt"
      `;
      const res = await pool.query(updSql, [encrypted, client.id]);
      row = res.rows[0];
    }

    await pool.query(
      `UPDATE public.clients
          SET "secretPhraseForceAt" = NULL,
              "updatedAt" = NOW()
        WHERE id = $1`,
      [client.id],
    );

    return NextResponse.json(row, { status: 200 });
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.errors }, { status: 400 });
    }
    console.error("[PATCH /api/clients/secret-phrase/[id]] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/* ───────── DELETE: clear phrase (reset) ───────── */
export async function DELETE(req: NextRequest, ctx: Ctx) {
  const session = await getContext(req);
  if (session instanceof NextResponse) return session;
  const { organizationId } = session;
  const { id: userId } = await ctx.params;

  try {
    const client = await getClientByTelegramId(userId, organizationId);
    if (!client) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }

    const delSql = `DELETE FROM "clientSecretPhrase" WHERE "clientId" = $1`;
    const result = await pool.query(delSql, [client.id]);

    // Optionally set a force prompt after reset
    await pool.query(
      `UPDATE public.clients
          SET "secretPhraseForceAt" = NOW(),
              "updatedAt" = NOW()
        WHERE id = $1`,
      [client.id],
    );

    return NextResponse.json(
      { ok: true, deleted: (result.rowCount ?? 0) > 0 },
      { status: 200 },
    );
  } catch (err: any) {
    console.error("[DELETE /api/clients/secret-phrase/[id]] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
