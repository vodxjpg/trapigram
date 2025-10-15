// src/app/api/pos/checkout/route.ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { pgPool as pool } from "@/lib/db";
import { v4 as uuidv4 } from "uuid";
import crypto from "crypto";
import { getContext } from "@/lib/context";

/* -------- helpers -------- */
async function loadCartSummary(cartId: string) {
  const { rows } = await pool.query(
    `SELECT ca.id, ca."clientId", ca.country, ca."cartUpdatedHash", ca.status, ca.channel,
            cl."firstName", cl."lastName", cl.username, cl."levelId"
       FROM carts ca
       JOIN clients cl ON cl.id = ca."clientId"
      WHERE ca.id = $1`,
    [cartId]
  );
  if (!rows.length) return null;

  const c = rows[0];
  const clientDisplayName =
    [c.firstName, c.lastName].filter(Boolean).join(" ").trim() ||
    c.username || "Customer";

  const { rows: sum } = await pool.query<{ subtotal: string }>(
    `SELECT COALESCE(SUM(quantity * "unitPrice"),0)::numeric AS subtotal
       FROM "cartProducts"
      WHERE "cartId" = $1`,
    [cartId]
  );

  return {
    cartId: c.id as string,
    clientId: c.clientId as string,
    country: c.country as string,
    cartUpdatedHash: c.cartUpdatedHash as string,
    status: !!c.status,
    channel: (c.channel as string | null) ?? "web",
    clientDisplayName,
    levelId: (c.levelId as string | null) ?? "default",
    subtotal: Number(sum[0]?.subtotal ?? 0),
  };
}

async function activePaymentMethods(tenantId: string) {
  const { rows } = await pool.query(
    `SELECT id, name, active, "default", description, instructions
       FROM "paymentMethods"
      WHERE "tenantId" = $1 AND active = TRUE
      ORDER BY "createdAt" DESC`,
    [tenantId]
  );
  return rows;
}

/* -------- schemas -------- */
const CheckoutCreateSchema = z.object({
  cartId: z.string().min(1),
  paymentMethodId: z.string().min(1),
});

/* GET: return summary + ACTIVE payment methods */
export async function GET(req: NextRequest) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;

  const { tenantId } = ctx as { tenantId: string | null };
  if (!tenantId) return NextResponse.json({ error: "Tenant not found" }, { status: 404 });

  const url = new URL(req.url);
  const cartId = url.searchParams.get("cartId");
  if (!cartId) return NextResponse.json({ error: "cartId is required" }, { status: 400 });

  const summary = await loadCartSummary(cartId);
  if (!summary) return NextResponse.json({ error: "Cart not found" }, { status: 404 });

  // ✅ Only allow POS carts where channel starts with "pos-"
  if (typeof summary.channel !== "string" || !summary.channel.toLowerCase().startsWith("pos-")) {
    return NextResponse.json({ error: "Not a POS cart" }, { status: 400 });
  }

  const methods = await activePaymentMethods(tenantId);
  return NextResponse.json({ summary, paymentMethods: methods }, { status: 200 });
}

/* POST: create order for POS cart */
export async function POST(req: NextRequest) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;

  const { tenantId, organizationId } = ctx as { tenantId: string | null; organizationId: string };
  try {
    const { cartId, paymentMethodId } = CheckoutCreateSchema.parse(await req.json());
    if (!tenantId) return NextResponse.json({ error: "Tenant not found" }, { status: 404 });

    const summary = await loadCartSummary(cartId);
    if (!summary) return NextResponse.json({ error: "Cart not found" }, { status: 404 });
    if (!summary.status) return NextResponse.json({ error: "Cart is not active" }, { status: 400 });

    // ✅ Enforce "pos-" prefix for checkout
    if (typeof summary.channel !== "string" || !summary.channel.toLowerCase().startsWith("pos-")) {
      return NextResponse.json({ error: "Only POS carts can be checked out here" }, { status: 400 });
    }

    // Validate payment method is ACTIVE for this tenant
    const { rows: pmRows } = await pool.query(
      `SELECT id, name, active FROM "paymentMethods" WHERE id = $1 AND "tenantId" = $2`,
      [paymentMethodId, tenantId]
    );
    const pm = pmRows[0];
    if (!pm || pm.active !== true) {
      return NextResponse.json({ error: "Invalid or inactive payment method" }, { status: 400 });
    }

    const shippingTotal = 0;
    const discountTotal = 0;
    const subtotal = summary.subtotal;
    const totalAmount = subtotal + shippingTotal - discountTotal;

    const orderId = uuidv4();
    const orderKey = "pos-" + crypto.randomBytes(6).toString("hex");

    const { rows: cartRow } = await pool.query(
      `SELECT "couponCode" FROM carts WHERE id = $1`,
      [cartId]
    );
    const couponCode: string | null = cartRow[0]?.couponCode ?? null;

    const insertSql = `
      INSERT INTO orders (
        id, "clientId", "cartId", country, status,
        "paymentMethod", "orderKey", "cartHash",
        "shippinTotal", "discountTotal", "totalAmount",
        "couponCode", "shippingService",
        "dateCreated", "datePaid", "dateCompleted", "dateCancelled",
        "createdAt", "updatedAt", "organizationId", channel
      )
      VALUES (
        $1,$2,$3,$4,$5,
        $6,$7,$8,
        $9,$10,$11,
        $12,$13,
        $14,$15,$16,$17,
        NOW(),NOW(),$18,$19
      )
      RETURNING *`;
    const vals = [
      orderId,
      summary.clientId,
      summary.cartId,
      summary.country,
      "paid",
      pm.id,
      orderKey,
      summary.cartUpdatedHash,
      shippingTotal,
      discountTotal,
      totalAmount,
      couponCode,
      "-",
      new Date(),
      new Date(),
      new Date(),
      null,
      organizationId,
      summary.channel, // ✅ keep the exact pos-... channel on the order
    ];

    const tx = await pool.connect();
    try {
      await tx.query("BEGIN");
      const { rows: orderRows } = await tx.query(insertSql, vals);
      const order = orderRows[0];

      await tx.query(`UPDATE carts SET status = FALSE, "updatedAt" = NOW() WHERE id = $1`, [cartId]);
      await tx.query("COMMIT");
      return NextResponse.json({ order }, { status: 201 });
    } catch (e) {
      await tx.query("ROLLBACK");
      throw e;
    } finally {
      tx.release();
    }
  } catch (err: any) {
    if (err instanceof z.ZodError) return NextResponse.json({ error: err.errors }, { status: 400 });
    console.error("[POS POST /pos/checkout] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
