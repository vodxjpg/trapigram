// src/app/api/order/[id]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { pgPool as pool } from "@/lib/db";
import crypto from "crypto";
import { getContext } from "@/lib/context";
import { z } from "zod";
import { db } from "@/lib/db";
/* ─── encryption helpers ─────────────────────────────────────── */
const ENC_KEY_B64 = process.env.ENCRYPTION_KEY || "";
const ENC_IV_B64 = process.env.ENCRYPTION_IV || "";

function getEncryptionKeyAndIv(): { key: Buffer; iv: Buffer } {
  const key = Buffer.from(ENC_KEY_B64, "base64");
  const iv = Buffer.from(ENC_IV_B64, "base64");
  if (key.length !== 32) throw new Error("ENCRYPTION_KEY must be 32-byte");
  if (iv.length !== 16) throw new Error("ENCRYPTION_IV must be 16-byte");
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

/* ================================================================= */
/* GET – full order with both normal & affiliate products             */
/* ================================================================= */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { id } = await params;

  // 1. Load order
  const orderRes = await pool.query(`SELECT * FROM orders WHERE id = $1`, [id]);
  if (!orderRes.rowCount)
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  const order = orderRes.rows[0];

  // 2. Load client
  const clientRes = await pool.query(`SELECT * FROM clients WHERE id = $1`, [
    order.clientId,
  ]);
  const client = clientRes.rows[0];

  // 3. Pull in normal products
  const normalRes = await pool.query(
    `
    SELECT
      p.id,
      p.title,
      p.description,
      p.image,
      p.sku,
      cp.quantity,
      cp."unitPrice"
    FROM products p
    JOIN "cartProducts" cp
      ON p.id = cp."productId"
    WHERE cp."cartId" = $1
    ORDER BY p.title
  `,
    [order.cartId]
  );

  // 4. Pull in affiliate products
  const affRes = await pool.query(
    `
    SELECT
      ap.id,
      ap.title,
      ap.description,
      ap.image,
      ap.sku,
      cp.quantity,
      cp."unitPrice"
    FROM "affiliateProducts" ap
    JOIN "cartProducts" cp
      ON ap.id = cp."affiliateProductId"
    WHERE cp."cartId" = $1
    ORDER BY ap.title
  `,
    [order.cartId]
  );

  // 5. Merge both lists
  const all = [
    ...normalRes.rows.map((r: any) => ({ ...r, isAffiliate: false })),
    ...affRes.rows.map((r: any) => ({ ...r, isAffiliate: true })),
  ];

  const products = all.map((r: any) => ({
    id: r.id,
    title: r.title,
    description: r.description,
    image: r.image,
    sku: r.sku,
    quantity: r.quantity,
    unitPrice: Number(r.unitPrice),
    isAffiliate: r.isAffiliate,
    subtotal: Number(r.unitPrice) * r.quantity,
  }));

  // 6. Compute subtotal *only* across non-affiliate (monetary) items
  const subtotal = products
    .filter(p => !p.isAffiliate)
    .reduce((sum, p) => sum + p.subtotal, 0);

  // 7. Build full response
  const full = {
    id: order.id,
    orderKey: order.orderKey,
    clientId: order.clientId,
    cartId: order.cartId,
    status: order.status,
    country: order.country,
    orderMeta: order.orderMeta ?                        // jsonb → JS object
      (typeof order.orderMeta === "string"
        ? JSON.parse(order.orderMeta)        // pg hasn’t parsed
        : order.orderMeta)                   // pg already parsed
      : [],
    products,
    coupon: order.couponCode,
    couponType: order.couponType,
    discount: Number(order.discountTotal),
    discountValue: Number(order.discountValue),
    shipping: Number(order.shippingTotal),
    subtotal,
    total: Number(order.totalAmount),
    pointsRedeemed: order.pointsRedeemed,
    pointsRedeemedAmount: Number(order.pointsRedeemedAmount),
    referredBy: order.referredBy,
    referralAwarded: order.referralAwarded === true,
    trackingNumber: order.trackingNumber,
    referredBy: client?.referredBy ?? null,
    shippingInfo: {
      address: decryptSecretNode(order.address),
      company: order.shippingService,
      method: order.shippingMethod,
      payment: order.paymentMethod,
    },
    client: {
      firstName: client.firstName,
      lastName: client.lastName,
      username: client.username,
      email: client.email ?? "",
    },
  };

  return NextResponse.json(full, { status: 200 });
}

/* ================================================================= */
/* PATCH – update editable fields (address, totals, tracking)        */
/* ================================================================= */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  // enforce order:update
  const { id } = await params;

  /* -----------------------------------------------------------------
   0. Parse body and normalise `paymentMethod`
      (the front-end may send either `paymentMethod` or `paymentMethodId`)
------------------------------------------------------------------ */
  const raw = await req.json();
  const body: Record<string, any> = { ...raw };
  console.log("[PATCH /order/:id] ctx =", ctx);
  if ("paymentMethodId" in raw && !("paymentMethod" in raw)) {
    body.paymentMethod = raw.paymentMethodId;           // keep both names working
  }

  const fields: string[] = [];
  const values: any[] = [];

  // ── allow updating our new flag ─────────────────────────────
  if ("referralAwarded" in body) {
    fields.push(`"referralAwarded" = $${fields.length + 1}`);
    values.push(body.referralAwarded);
  }

  // ── 1. orderMeta  (expects array) ────────────────────────────
  if ("orderMeta" in body) {
    const metaArr = z.array(z.any()).parse(body.orderMeta);          // basic guard
    /*  jsonb concatenation: existing || new_chunk  */
    fields.push(
      `"orderMeta" = COALESCE("orderMeta",'[]'::jsonb) || $${fields.length + 1}::jsonb`
    );
    values.push(JSON.stringify(metaArr));
  }

  if ("discount" in body) {
    fields.push(`"discountTotal" = $${fields.length + 1}`);
    values.push(body.discount);
  }
  if ("couponCode" in body) {
    fields.push(`"couponCode" = $${fields.length + 1}`);
    values.push(body.couponCode);
  }
  if ("address" in body) {
    fields.push(`address = $${fields.length + 1}`);
    values.push(encryptSecretNode(body.address));
  }
  if ("total" in body) {
    fields.push(`"totalAmount" = $${fields.length + 1}`);
    values.push(body.total);
  }
  if ("trackingNumber" in body) {
    fields.push(`"trackingNumber" = $${fields.length + 1}`);
    values.push(body.trackingNumber || null);
  }

  /* ──────────────────────────────────────────────────────────────
   NEW ① – payment-method updates (+ Niftipay “delete-old” flow)
────────────────────────────────────────────────────────────── */
  if ("paymentMethod" in body) {
    const newPM: string = body.paymentMethod;

    /* ①-a  fetch current paymentMethod + orderKey for comparison */
    const { rows } = await pool.query(
      `SELECT "paymentMethod","orderKey" FROM orders WHERE id = $1`,
      [id],
    );
    if (!rows.length)
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    const current = rows[0] as { paymentMethod: string | null; orderKey: string };

    /* ①-b  if we’re *leaving* Niftipay → delete the old invoice    */
      if (
          current.paymentMethod?.toLowerCase() === "niftipay" &&
          newPM.toLowerCase() !== "niftipay"
        ) {
          // lookup the tenant’s API key
          const pmRow = await db
            .selectFrom("paymentMethods")
            .select("apiKey")
            .where("tenantId", "=", ctx.tenantId)
            .where("name", "=", "Niftipay")
            .executeTakeFirst();
          const nifiApiKey = pmRow?.apiKey;
          if (!nifiApiKey) {
            return NextResponse.json(
              { error: "No Niftipay credentials configured" },
              { status: 500 }
            );
          }
      
          // attempt DELETE, but ignore 404 (already gone)
          try {
            const resDel = await fetch(
              `${process.env.NIFTIPAY_API_URL ?? "https://www.niftipay.com"}/api/orders?reference=${encodeURIComponent(current.orderKey)}`,
              {
                method: "DELETE",
                headers: { "x-api-key": nifiApiKey },
              }
            );
            if (!resDel.ok && resDel.status !== 404) {
              const bodyErr = await resDel.json().catch(() => ({}));
              return NextResponse.json(
                { error: bodyErr.error ?? "Unable to delete Niftipay order" },
                { status: 400 }
              );
            }
            // if 404 or 2xx, continue
          } catch (err: any) {
            return NextResponse.json(
              { error: err.message ?? "Niftipay deletion failed" },
              { status: 400 }
            );
          }
        }
   

    /* ①-c  persist the new payment method                       */
    fields.push(`"paymentMethod" = $${fields.length + 1}`);
    values.push(newPM);
  }

  if (!fields.length)
    return NextResponse.json({ error: "No updatable fields" }, { status: 400 });

  const sql = `
    UPDATE orders
    SET ${fields.join(", ")}, "updatedAt" = NOW()
    WHERE id = $${fields.length + 1}
    RETURNING *
  `;
  values.push(id);
  const r = await pool.query(sql, values);

  return NextResponse.json(r.rows[0], { status: 200 });
}

/* ================================================================= */
/*  PUT – replace orderMeta array (used by bot upsert)               */
/* ================================================================= */

const putSchema = z.object({
  orderMeta: z.array(z.any()),
});

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { id } = await params;

  /* validate body */
  let body: z.infer<typeof putSchema>;
  try {
    body = putSchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  await pool.query(
    `UPDATE orders
        SET "orderMeta" = $1::jsonb,
            "updatedAt" = NOW()
      WHERE id = $2
        AND "organizationId" = $3`,
    [JSON.stringify(body.orderMeta), id, ctx.organizationId],
  );

  return NextResponse.json({ ok: true }, { status: 200 });
}