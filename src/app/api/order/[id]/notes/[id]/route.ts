// src/app/api/order-notes/[id]/route.ts
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { pgPool as pool } from "@/lib/db";
import { getContext } from "@/lib/context";
import crypto from "crypto";

/* ────────────────────────── encryption helpers ────────────────────────── */
const ENC_KEY_B64 = process.env.ENCRYPTION_KEY || "";
const ENC_IV_B64 = process.env.ENCRYPTION_IV || "";
function getEncryptionKeyAndIv(): { key: Buffer; iv: Buffer } {
  const key = Buffer.from(ENC_KEY_B64, "base64");
  const iv = Buffer.from(ENC_IV_B64, "base64");
  if (!ENC_KEY_B64 || !ENC_IV_B64) throw new Error("ENCRYPTION_* env vars missing");
  if (key.length !== 32) throw new Error("ENCRYPTION_KEY must decode to 32 bytes");
  if (iv.length !== 16) throw new Error("ENCRYPTION_IV must decode to 16 bytes");
  return { key, iv };
}
function encryptSecretNode(plain: string): string {
  const { key, iv } = getEncryptionKeyAndIv();
  const cipher = crypto.createCipheriv("aes-256-cbc", key, iv);
  return cipher.update(plain, "utf8", "base64") + cipher.final("base64");
}
function decryptSecretNode(enc: string): string {
  const { key, iv } = getEncryptionKeyAndIv();
  const d = crypto.createDecipheriv("aes-256-cbc", key, iv);
  return d.update(enc, "base64", "utf8") + d.final("utf8");
}

/* ────────────────────────── zod ────────────────────────── */
const patchSchema = z.object({
  note: z.string().min(1).optional(),
  visibleToCustomer: z.boolean().optional(),
});

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { organizationId } = ctx;

  const { rows } = await pool.query(
    `SELECT id,"orderId","organizationId","authorRole","authorClientId","authorUserId",
            note,"visibleToCustomer","createdAt","updatedAt"
       FROM "orderNotes"
      WHERE id = $1 AND "organizationId" = $2
      LIMIT 1`,
    [params.id, organizationId],
  );
  if (!rows.length) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const r = rows[0];
  return NextResponse.json(
    {
      id: r.id,
      orderId: r.orderId,
      organizationId: r.organizationId,
      authorRole: r.authorRole as "client" | "staff",
      authorClientId: r.authorClientId as string | null,
      authorUserId: r.authorUserId as string | null,
      note: (() => { try { return decryptSecretNode(r.note); } catch { return ""; } })(),
      visibleToCustomer: r.visibleToCustomer === true,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    },
    { status: 200 }
  );
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { organizationId } = ctx;

  let body: z.infer<typeof patchSchema>;
  try {
    body = patchSchema.parse(await req.json());
  } catch (e: any) {
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: e.errors }, { status: 400 });
    }
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  if (!("note" in body) && !("visibleToCustomer" in body)) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  // fetch current row
  const { rows: curRows } = await pool.query(
    `SELECT note FROM "orderNotes" WHERE id = $1 AND "organizationId" = $2 LIMIT 1`,
    [params.id, organizationId],
  );
  if (!curRows.length) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const sets: string[] = [];
  const vals: any[] = [];
  if (typeof body.note === "string") {
    sets.push(`note = $${sets.length + 1}`);
    vals.push(encryptSecretNode(body.note));
  }
  if (typeof body.visibleToCustomer === "boolean") {
    sets.push(`"visibleToCustomer" = $${sets.length + 1}`);
    vals.push(body.visibleToCustomer);
  }
  vals.push(params.id, organizationId);

  const sql = `
    UPDATE "orderNotes"
       SET ${sets.join(", ")}, "updatedAt" = NOW()
     WHERE id = $${vals.length - 1} AND "organizationId" = $${vals.length}
     RETURNING id,"orderId","organizationId","authorRole","authorClientId","authorUserId",
               note,"visibleToCustomer","createdAt","updatedAt"
  `;
  const { rows } = await pool.query(sql, vals);
  const r = rows[0];

  return NextResponse.json(
    {
      id: r.id,
      orderId: r.orderId,
      organizationId: r.organizationId,
      authorRole: r.authorRole as "client" | "staff",
      authorClientId: r.authorClientId as string | null,
      authorUserId: r.authorUserId as string | null,
      note: (() => { try { return decryptSecretNode(r.note); } catch { return ""; } })(),
      visibleToCustomer: r.visibleToCustomer === true,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    },
    { status: 200 }
  );
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { organizationId } = ctx;

  const { rowCount } = await pool.query(
    `DELETE FROM "orderNotes"
      WHERE id = $1 AND "organizationId" = $2`,
    [params.id, organizationId],
  );
  if (!rowCount) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json({ ok: true }, { status: 200 });
}
