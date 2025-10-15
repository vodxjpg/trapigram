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

  // Normalize legacy 'pos' → 'pos-' once, so startsWith("pos-") checks pass.
  let normalizedChannel: string =
    (typeof c.channel === "string" ? c.channel : "web") || "web";

  if (normalizedChannel.toLowerCase() === "pos") {
    try {
      await pool.query(`UPDATE carts SET channel = $1 WHERE id = $2`, ["pos-", cartId]);
      normalizedChannel = "pos-";
    } catch {
      // best effort; continue even if the update fails
    }
  }

  const clientDisplayName =
    [c.firstName, c.lastName].filter(Boolean).join(" ").trim() ||
    c.username ||
    "Customer";

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
    channel: normalizedChannel, // <- normalized
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
  payments: z
    .array(
      z.object({
        methodId: z.string().min(1),
        amount: z.number().positive(),
      })
    )
    .min(1, "At least one payment is required"),
});

/* =========================================================
   GET /api/pos/checkout?cartId=...
   → returns { summary, paymentMethods } for ACTIVE methods
   ========================================================= */
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

  // Only allow POS carts where channel starts with "pos-"
  if (typeof summary.channel !== "string" || !summary.channel.toLowerCase().startsWith("pos-")) {
    return NextResponse.json({ error: "Not a POS cart" }, { status: 400 });
  }

  const methods = await activePaymentMethods(tenantId);
  return NextResponse.json({ summary, paymentMethods: methods }, { status: 200 });
}

/* =========================================================
   POST /api/pos/checkout
   body: { cartId, payments: [{methodId, amount}, ...] }
   - validates ACTIVE payment methods
   - supports split payments
   - writes order with channel preserved (pos-…)
   ========================================================= */
export async function POST(req: NextRequest) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;

  const { tenantId, organizationId } = ctx as { tenantId: string | null; organizationId: string };

  try {
    const { cartId, payments } = CheckoutCreateSchema.parse(await req.json());
    if (!tenantId) return NextResponse.json({ error: "Tenant not found" }, { status: 404 });

    const summary = await loadCartSummary(cartId);
    if (!summary) return NextResponse.json({ error: "Cart not found" }, { status: 404 });
    if (!summary.status) return NextResponse.json({ error: "Cart is not active" }, { status: 400 });

    // Enforce "pos-" prefix after normalization
    if (typeof summary.channel !== "string" || !summary.channel.toLowerCase().startsWith("pos-")) {
      return NextResponse.json({ error: "Only POS carts can be checked out here" }, { status: 400 });
    }

    // Validate payment methods belong to tenant and are ACTIVE
    const methods = await activePaymentMethods(tenantId);
    if (!methods.length) {
      return NextResponse.json({ error: "No active payment methods configured" }, { status: 400 });
    }
    const activeIds = new Set(methods.map((m: any) => m.id));
    for (const p of payments) {
      if (!activeIds.has(p.methodId)) {
        return NextResponse.json(
          { error: `Inactive/invalid payment method: ${p.methodId}` },
          { status: 400 }
        );
      }
    }

    // Totals
    const shippingTotal = 0;
    const discountTotal = 0;
    const subtotal = summary.subtotal;
    const totalAmount = subtotal + shippingTotal - discountTotal;

    // Require sum(payments) ≈ total
    const paid = payments.reduce((s, p) => s + Number(p.amount || 0), 0);
    const epsilon = 0.01; // allow 1 cent rounding
    if (Math.abs(paid - totalAmount) > epsilon) {
      return NextResponse.json(
        { error: `Paid amount ${paid.toFixed(2)} does not match total ${totalAmount.toFixed(2)}` },
        { status: 400 }
      );
    }

    const orderId = uuidv4();
    const orderKey = "pos-" + crypto.randomBytes(6).toString("hex");

    // Pull current cart coupon (if any)
    const { rows: cartRow } = await pool.query(
      `SELECT "couponCode" FROM carts WHERE id = $1`,
      [cartId]
    );
    const couponCode: string | null = cartRow[0]?.couponCode ?? null;

    // Store the first method id for compatibility (optional: persist split in orderPayments)
    const primaryMethodId = payments[0].methodId;

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
      primaryMethodId,
      orderKey,
      summary.cartUpdatedHash,
      shippingTotal,
      discountTotal,
      totalAmount,
      couponCode,
      "-", // POS has no shipping service
      new Date(),
      new Date(),
      new Date(),
      null,
      organizationId,
      summary.channel, // keep exact "pos-..." channel
    ];

    const tx = await pool.connect();
    try {
      await tx.query("BEGIN");

      const { rows: orderRows } = await tx.query(insertSql, vals);
      const order = orderRows[0];

      // Optional: persist split payments in an orderPayments table here.

      // Close cart
      await tx.query(
        `UPDATE carts SET status = FALSE, "updatedAt" = NOW() WHERE id = $1`,
        [cartId]
      );

      await tx.query("COMMIT");
      return NextResponse.json({ order }, { status: 201 });
    } catch (e) {
      await tx.query("ROLLBACK");
      throw e;
    } finally {
      tx.release();
    }
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.errors }, { status: 400 });
    }
    console.error("[POS POST /pos/checkout] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
