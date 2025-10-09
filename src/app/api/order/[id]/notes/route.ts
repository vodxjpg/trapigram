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

              // Build an admin-facing message: show order number + note content
        const esc = (s: string) =>
          s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
        const message =
          `The user has left a note for order <b>#${esc(String(key))}</b>:\n\n${esc(payload.note)}`;
       // Force admin_only so it goes to notification groups (not buyer DM)
      await sendNotification({
        type: "order_message",         // re-use existing type (no template needed)
        message,
        orderId,
        country: order.country ?? null,
        channels: ["telegram", "in_app", "webhook"], // same spirit as paid-order alerts
        organizationId,               // injected in notifications route; include here for clarity
        clientId: payload.authorClientId ?? null,
        userId: null,
        trigger: "admin_only",
                  // Include structured vars in case templates are used elsewhere
          variables: {
            order_number: String(key),
            note_content: payload.note,
          },
      });
       console.log("[order-note] fired admin_only notification", { orderKey: key, org: organizationId });
    }
  } catch (e) {
    // Don’t block note creation if notification fails
    console.error("[order note notification] failed:", e);
  }

  // ────────────────────────── fire *customer* notification on staff note made visible ──────────────────────────
  try {
    if (payload.authorRole === "staff" && payload.visibleToCustomer === true) {
      // Resolve order meta needed to route to the right customer
      const { rows: orderRows2 } = await pool.query(
        `SELECT "orderKey", country, "clientId"
           FROM orders
          WHERE id = $1 AND "organizationId" = $2
          LIMIT 1`,
        [orderId, organizationId],
      );
      const order2 = orderRows2[0] || {};
      const key =
        order2.orderKey ??
        // fallback: last 6 chars of id (cosmetic only)
        String(orderId).slice(-6);

      const esc = (s: string) =>
        s.replace(/&/g, "&amp;")
         .replace(/</g, "&lt;")
         .replace(/>/g, "&gt;");

      // User-facing text
      const message =
        `You have a new note on your order <b>#${esc(String(key))}</b>:\n\n${esc(payload.note)}`;

      await sendNotification({
        organizationId,
        type: "order_message",
        message,
        subject: undefined,
        variables: {
          order_number: String(key),
          note_content: payload.note,
        },
        orderId,
        country: order2.country ?? null,
        trigger: "user_only_email",               // suppress admin fan-out
        channels: ["telegram", "in_app", "email"],
        userId: null,
        clientId: order2.clientId ?? null,
      });
      console.log("[order-note] fired user notification", { orderKey: key, org: organizationId });
    }
  } catch (e) {
    console.error("[order note notification] user notify failed:", e);
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
