// src/app/api/order/[id]/notes/route.ts
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { pgPool as pool } from "@/lib/db";
import { getContext } from "@/lib/context";
import { v4 as uuidv4 } from "uuid";
import { sendNotification } from "@/lib/notifications";
import crypto from "crypto";


/* ────────────────────────── encryption helpers (AES-256-CBC) ────────────────────────── */
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
const listQuerySchema = z.object({
  scope: z.enum(["customer", "staff"]).default("staff"), // controls filtering
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(100).default(20),
});

const createSchema = z.object({
  note: z.string().min(1),
  visibleToCustomer: z.boolean().default(false),
  authorRole: z.enum(["client", "staff"]),
  authorClientId: z.string().uuid().optional(),
  authorUserId: z.string().optional(),
}).superRefine((val, ctx) => {
  if (val.authorRole === "client" && !val.authorClientId) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "authorClientId is required when authorRole is 'client'" });
  }
  if (val.authorRole === "staff" && !val.authorUserId) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "authorUserId is required when authorRole is 'staff'" });
  }
});

/* ────────────────────────── GET – list notes for an order ────────────────────────── */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { organizationId } = ctx;
  const orderId = params.id;

  // Ensure the order belongs to this org
  const { rowCount: okOrder } = await pool.query(
    `SELECT 1 FROM orders WHERE id = $1 AND "organizationId" = $2 LIMIT 1`,
    [orderId, organizationId],
  );
  if (!okOrder) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  const qp = listQuerySchema.parse(
    Object.fromEntries(new URL(req.url).searchParams.entries())
  );

  const vals: any[] = [organizationId, orderId];
  const where: string[] = [`"organizationId" = $1`, `"orderId" = $2`];

  if (qp.scope === "customer") {
    where.push(`"visibleToCustomer" = TRUE`);
  }

  // pagination
  const countSql = `SELECT COUNT(*)::int AS cnt FROM "orderNotes" WHERE ${where.join(" AND ")}`;
  const { rows: [{ cnt }] } = await pool.query<{ cnt: number }>(countSql, vals);
  const total = cnt;
  const totalPages = Math.max(1, Math.ceil(total / qp.pageSize));
  const offset = (qp.page - 1) * qp.pageSize;

  const selectSql = `
    SELECT id,"orderId","organizationId","authorRole","authorClientId","authorUserId",
           note,"visibleToCustomer","createdAt","updatedAt"
      FROM "orderNotes"
     WHERE ${where.join(" AND ")}
     ORDER BY "createdAt" DESC
     LIMIT $${vals.length + 1} OFFSET $${vals.length + 2}
  `;
  const { rows } = await pool.query(selectSql, [...vals, qp.pageSize, offset]);

  const notes = rows.map(r => ({
    id: r.id,
    orderId: r.orderId,
    organizationId: r.organizationId,
    authorRole: r.authorRole as "client" | "staff",
    authorClientId: r.authorClientId as string | null,
    authorUserId: r.authorUserId as string | null,
    note: (() => {
      try { return decryptSecretNode(r.note); } catch { return ""; }
    })(),
    visibleToCustomer: r.visibleToCustomer === true,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  }));

  return NextResponse.json({ notes, totalPages, currentPage: qp.page }, { status: 200 });
}

/* ────────────────────────── POST – create a note ────────────────────────── */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { organizationId } = ctx;
  const orderId = params.id;

  // Ensure the order belongs to this org
  const { rows: ordRows } = await pool.query(
    `SELECT id FROM orders WHERE id = $1 AND "organizationId" = $2 LIMIT 1`,
    [orderId, organizationId],
  );
  if (!ordRows.length) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  let payload: z.infer<typeof createSchema>;
  try {
    payload = createSchema.parse(await req.json());
  } catch (e: any) {
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: e.errors }, { status: 400 });
    }
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const id = uuidv4();
  const enc = encryptSecretNode(payload.note);

  const insertSql = `
    INSERT INTO "orderNotes"
      (id,"orderId","organizationId","authorRole","authorClientId","authorUserId",
       note,"visibleToCustomer","createdAt","updatedAt")
    VALUES
      ($1,$2,$3,$4,$5,$6,$7,$8,NOW(),NOW())
    RETURNING id,"orderId","organizationId","authorRole","authorClientId","authorUserId",
              note,"visibleToCustomer","createdAt","updatedAt"
  `;
  const { rows } = await pool.query(insertSql, [
    id,
    orderId,
    organizationId,
    payload.authorRole,
    payload.authorRole === "client" ? payload.authorClientId! : null,
    payload.authorRole === "staff" ? payload.authorUserId! : null,
    enc,
    payload.visibleToCustomer,
  ]);
  const r = rows[0];

  // ────────────────────────── fire admin notification on client note ──────────────────────────
  try {
    if (payload.authorRole === "client") {
      // Get orderKey and country for routing
      const { rows: orderRows } = await pool.query(
        `SELECT "orderKey", country
           FROM orders
          WHERE id = $1 AND "organizationId" = $2
          LIMIT 1`,
        [orderId, organizationId]
      );
      const order = orderRows[0] || {};
      const key =
        order.orderKey ??
        // fallback: last 6 chars of id (purely cosmetic, in case orderKey is missing)
        String(orderId).slice(-6);

      const message =
        `Order #${key} got a new note:\n\n${payload.note}`;

      await sendNotification({
        type: "order_message",         // re-use existing type (no template needed)
        message,
        country: order.country ?? null,
        channels: ["telegram", "in_app", "webhook"], // same spirit as paid-order alerts
        organizationId,               // injected in notifications route; include here for clarity
        clientId: payload.authorClientId ?? null,
        userId: null,
        trigger: "order_note",
      });
    }
  } catch (e) {
    // Don’t block note creation if notification fails
    console.error("[order note notification] failed:", e);
  }

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
    { status: 201 }
  );
}
