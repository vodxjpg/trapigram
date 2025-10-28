// src/app/api/pos/checkout/route.ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { pgPool as pool } from "@/lib/db";
import { v4 as uuidv4 } from "uuid";
import crypto from "crypto";
import { getContext } from "@/lib/context";
import { enqueueNotificationFanout } from "@/lib/notification-outbox";
import { emitIdleForCart } from "@/lib/customer-display-emit";
import { tierPricing, getPriceForQuantity, type Tier } from "@/lib/tier-pricing";
import { adjustStock } from "@/lib/stock";
import withIdempotency from "@/lib/idempotency"; // ← USE CENTRALIZED SAFE HELPER

/* ========= Fast tier repricing (same as before) ========= */

const TIER_TTL_MS = 120_000;
const tierCache = new Map<string, { at: number; data: Tier[] }>();
async function getTiersCached(orgId: string): Promise<Tier[]> {
  const now = Date.now();
  const hit = tierCache.get(orgId);
  if (hit && now - hit.at < TIER_TTL_MS) return hit.data;
  const data = (await tierPricing(orgId)) as Tier[];
  tierCache.set(orgId, { at: now, data });
  return data;
}
function targetsList(t: Tier): string[] {
  return ((((t as any).clients as string[] | undefined) ??
          ((t as any).customers as string[] | undefined) ??
          []) as string[]).filter(Boolean);
}

async function repriceCart(
  cartId: string,
  organizationId: string,
  { dryRun, client }: { dryRun: boolean; client?: any }
): Promise<{ subtotal: number; changedLines: number }> {
  const db = client ?? pool;

  const { rows: cRows } = await db.query(
    `SELECT country, "clientId" FROM carts WHERE id=$1 LIMIT 1`,
    [cartId]
  );
  if (!cRows.length) return { subtotal: 0, changedLines: 0 };
  const country = String(cRows[0].country || "").toUpperCase();
  const clientId = String(cRows[0].clientId || "");

  const tiersAll = await getTiersCached(organizationId);
  const inCountry = (t: Tier) => t.active === true && (t.countries || []).some((c) => String(c || "").toUpperCase() === country);
  const targeted = tiersAll.filter((t) => inCountry(t) && targetsList(t).includes(clientId));
  const global   = tiersAll.filter((t) => inCountry(t) && targetsList(t).length === 0);

  const { rows: raw } = await db.query(
    `SELECT id,"productId","affiliateProductId","variationId",quantity,"unitPrice"
       FROM "cartProducts" WHERE "cartId"=$1`,
    [cartId]
  );
  const lines = raw
    .filter((r: any) => !r.affiliateProductId)
    .map((r: any) => ({
      id: String(r.id),
      productId: String(r.productId),
      variationId: r.variationId ? String(r.variationId) : null,
      quantity: Number(r.quantity || 0),
      unitPrice: Number(r.unitPrice || 0),
    }));

  const indexByProduct = new Map<string, number[]>();
  const indexByVar = new Map<string, number[]>();
  lines.forEach((l, idx) => {
    (indexByProduct.get(l.productId) ?? indexByProduct.set(l.productId, []).get(l.productId)!).push(idx);
    if (l.variationId) {
      (indexByVar.get(l.variationId) ?? indexByVar.set(l.variationId, []).get(l.variationId)!).push(idx);
    }
  });

  const newPriceByLine = new Map<number, number>();
  const lockedProducts = new Set<string>();
  const lockedVars = new Set<string>();

  const applyTier = (t: Tier) => {
    const tierProdIds = (t.products || []).map((p: any) => p.productId).filter(Boolean) as string[];
    const tierVarIds  = (t.products || []).map((p: any) => p.variationId).filter(Boolean) as string[];

    let qty = 0;
    for (const pid of tierProdIds) (indexByProduct.get(pid) || []).forEach(i => qty += lines[i].quantity);
    for (const vid of tierVarIds)  (indexByVar.get(vid)  || []).forEach(i => qty += lines[i].quantity);
    if (qty <= 0) return;

    const tierPrice = getPriceForQuantity((t as any).steps || [], qty);
    if (tierPrice == null) return;

    const willUpdateP: string[] = [];
    const willUpdateV: string[] = [];

    for (const pid of tierProdIds) {
      if (lockedProducts.has(pid)) continue;
      const idxs = indexByProduct.get(pid) || [];
      if (!idxs.length) continue;
      for (const i of idxs) newPriceByLine.set(i, tierPrice);
      willUpdateP.push(pid);
    }
    for (const vid of tierVarIds) {
      if (lockedVars.has(vid)) continue;
      const idxs = indexByVar.get(vid) || [];
      if (!idxs.length) continue;
      for (const i of idxs) newPriceByLine.set(i, tierPrice);
      willUpdateV.push(vid);
    }

    willUpdateP.forEach((p) => lockedProducts.add(p));
    willUpdateV.forEach((v) => lockedVars.add(v));
    return { willUpdateP, willUpdateV, tierPrice };
  };

  let changed = 0;

  const targetedPlan = targeted.map(applyTier).filter(Boolean) as Array<{ willUpdateP: string[]; willUpdateV: string[]; tierPrice: number }>;
  const globalPlan   = global  .map(applyTier).filter(Boolean) as Array<{ willUpdateP: string[]; willUpdateV: string[]; tierPrice: number }>;

  if (!dryRun) {
    for (const step of [...targetedPlan, ...globalPlan]) {
      if (step.willUpdateP.length) {
        const r = await db.query(
          `UPDATE "cartProducts"
              SET "unitPrice"=$1,"updatedAt"=NOW()
            WHERE "cartId"=$2 AND "productId" = ANY($3::text[]) AND "unitPrice" <> $1`,
          [step.tierPrice, cartId, step.willUpdateP],
        );
        changed += Number(r.rowCount || 0);
      }
      if (step.willUpdateV.length) {
        const r = await db.query(
          `UPDATE "cartProducts"
              SET "unitPrice"=$1,"updatedAt"=NOW()
            WHERE "cartId"=$2 AND "variationId" = ANY($3::text[]) AND "unitPrice" <> $1`,
          [step.tierPrice, cartId, step.willUpdateV],
        );
        changed += Number(r.rowCount || 0);
      }
    }
  }

  if (dryRun) {
    let subtotal = 0;
    for (let i = 0; i < lines.length; i++) {
      const price = newPriceByLine.has(i) ? newPriceByLine.get(i)! : lines[i].unitPrice;
      subtotal += price * lines[i].quantity;
    }
    const { rows: aff } = await db.query(
      `SELECT quantity,"unitPrice" FROM "cartProducts" WHERE "cartId"=$1 AND "affiliateProductId" IS NOT NULL`,
      [cartId]
    );
    for (const a of aff) subtotal += Number(a.quantity || 0) * Number(a.unitPrice || 0);
    return { subtotal, changedLines: 0 };
  } else {
    const { rows: sum } = await db.query(
      `SELECT COALESCE(SUM(quantity * "unitPrice"),0)::numeric AS subtotal
         FROM "cartProducts" WHERE "cartId"=$1`,
      [cartId]
    );
    const subtotal = Number(sum[0]?.subtotal ?? 0);
    return { subtotal, changedLines: changed };
  }
}

/* -------- helpers/schemas (same as before) -------- */

const euroCountries = [
  "AT","BE","HR","CY","EE","FI","FR","DE","GR","IE","IT","LV","LT","LU","MT",
  "NL","PT","SK","SI","ES"
];
const currencyFromCountry = (c: string) => c === "GB" ? "GBP" : euroCountries.includes(c) ? "EUR" : "USD";

const DiscountSchema = z.object({
  type: z.enum(["fixed", "percentage"]),
  value: z.number().nonnegative(),
}).optional();

const CheckoutCreateSchema = z.object({
  cartId: z.string().min(1),
  payments: z.array(z.object({ methodId: z.string().min(1), amount: z.number().positive() })).default([]),
  storeId: z.string().optional(),
  registerId: z.string().optional(),
  discount: DiscountSchema,
  parked: z.boolean().optional(),
});

type MinimalUser = { id: string; name: string | null } | null;
async function fetchCurrentUserFromSession(req: NextRequest): Promise<MinimalUser> {
  try {
    const origin = process.env.NEXT_PUBLIC_APP_URL || new URL(req.url).origin;
    const res = await fetch(`${origin}/api/users/current`, {
      headers: { cookie: req.headers.get("cookie") ?? "" },
      cache: "no-store",
    });
    if (!res.ok) return null;
    const data = await res.json().catch(() => ({}));
    const u = data?.user;
    if (!u) return null;
    return { id: u.id, name: u.name ?? null };
  } catch {
    return null;
  }
}

async function activePaymentMethods(tenantId: string) {
  const { rows } = await pool.query(
    `SELECT id, name, active, "default", description, instructions
       FROM "paymentMethods"
      WHERE "tenantId" = $1
        AND active = TRUE
        AND COALESCE("posVisible", TRUE) = TRUE
      ORDER BY "createdAt" DESC`,
    [tenantId]
  );
  return rows;
}
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
  let normalizedChannel: string = (typeof c.channel === "string" ? c.channel : "web") || "web";
  if (normalizedChannel.toLowerCase() === "pos") {
    try { await pool.query(`UPDATE carts SET channel = $1 WHERE id = $2`, ["pos-", cartId]); normalizedChannel = "pos-"; } catch {}
  }
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
    channel: normalizedChannel,
    clientDisplayName,
    levelId: (c.levelId as string | null) ?? "default",
    subtotal: Number(sum[0]?.subtotal ?? 0),
  };
}

export async function GET(req: NextRequest) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;

  const { tenantId, organizationId } = ctx as { tenantId: string | null; organizationId: string };
  if (!tenantId) return NextResponse.json({ error: "Tenant not found" }, { status: 404 });

  const url = new URL(req.url);
  const cartId = url.searchParams.get("cartId");
  if (!cartId) return NextResponse.json({ error: "cartId is required" }, { status: 400 });

  const summary = await loadCartSummary(cartId);
  if (!summary) return NextResponse.json({ error: "Cart not found" }, { status: 404 });
  if (typeof summary.channel !== "string" || !summary.channel.toLowerCase().startsWith("pos-")) {
    return NextResponse.json({ error: "Not a POS cart" }, { status: 400 });
  }

  const { subtotal: effectiveSubtotal } = await repriceCart(cartId, organizationId, { dryRun: true });
  const methods = await activePaymentMethods(tenantId);
  return NextResponse.json({ summary, paymentMethods: methods, effectiveSubtotal }, { status: 200 });
}

export async function POST(req: NextRequest) {
  return withIdempotency(req, async () => {
    const ctx = await getContext(req);
    if (ctx instanceof NextResponse) return ctx;

    const { tenantId, organizationId } = ctx as { tenantId: string | null; organizationId: string };

    try {
      const rawBody = await req.json();
      const { cartId, payments, storeId, registerId, discount, parked } =
        CheckoutCreateSchema.parse(rawBody);
      const isParked = Boolean(parked);
      if (!tenantId) return NextResponse.json({ error: "Tenant not found" }, { status: 404 });

      const summary = await loadCartSummary(cartId);
      if (!summary) return NextResponse.json({ error: "Cart not found" }, { status: 404 });
      if (!summary.status) return NextResponse.json({ error: "Cart is not active" }, { status: 400 });
      if (typeof summary.channel !== "string" || !summary.channel.toLowerCase().startsWith("pos-")) {
        return NextResponse.json({ error: "Only POS carts can be checked out here" }, { status: 400 });
      }

      const methods = await activePaymentMethods(tenantId);
      if (!methods.length) return NextResponse.json({ error: "No active payment methods configured" }, { status: 400 });
      const activeIds = new Set(methods.map((m: any) => m.id));
      for (const p of payments) {
        if (!activeIds.has(p.methodId)) {
          return NextResponse.json({ error: `Inactive/invalid payment method: ${p.methodId}` }, { status: 400 });
        }
      }

      // Optional: mark discount intent early
      let discountKind: "fixed" | "percentage" | null = null;
      let discountValue = 0;
      if (discount && Number.isFinite(discount.value) && discount.value > 0) {
        discountKind = discount.type;
        discountValue = discount.value;
        await pool.query(
          `UPDATE carts SET "couponCode" = $1, "updatedAt" = NOW() WHERE id = $2`,
          ["POS", cartId],
        );
      }

      const tx = await pool.connect();
      try {
        await tx.query("BEGIN");

        // *** Serialize competing checkouts for the same cart ***
        await tx.query(`SELECT id FROM carts WHERE id = $1 FOR UPDATE`, [cartId]);

        // Apply tiers and compute repriced subtotal
        const { subtotal: pricedSubtotal } = await repriceCart(cartId, organizationId, { dryRun: false, client: tx });

        // Hash
        const { rows: hv } = await tx.query(
          `SELECT COUNT(*)::int AS n,
                  COALESCE(SUM(quantity),0)::int AS q,
                  COALESCE(SUM((quantity * "unitPrice")::numeric),0)::text AS v
             FROM "cartProducts" WHERE "cartId"=$1`,
          [cartId]
        );
        const cartHash = crypto.createHash("sha256")
          .update(`${hv[0].n}|${hv[0].q}|${hv[0].v}`)
          .digest("hex");
        await tx.query(`UPDATE carts SET "cartUpdatedHash"=$1,"updatedAt"=NOW() WHERE id=$2`, [cartHash, cartId]);

        // Totals with discount
        const shippingTotal = 0;
        const subtotal = Number(pricedSubtotal || 0);

        let discountTotal = 0;
        let couponType: "fixed" | "percentage" | null = null;
        let discountValueArr: string[] = [];
        if (discountKind && discountValue > 0) {
          if (discountKind === "percentage") {
            const pct = Math.max(0, Math.min(100, discountValue));
            discountTotal = +(subtotal * (pct / 100)).toFixed(2);
            couponType = "percentage";
            discountValueArr = [String(pct)];
          } else {
            const fixed = Math.max(0, discountValue);
            discountTotal = +Math.min(subtotal, fixed).toFixed(2);
            couponType = "fixed";
            discountValueArr = [String(fixed)];
          }
        }

        const totalAmount = +(subtotal + shippingTotal - discountTotal).toFixed(2);
        const paid = payments.reduce((s, p) => s + Number(p.amount || 0), 0);
        const epsilon = 0.01;

        if (Math.abs(paid - totalAmount) > epsilon) {
          await tx.query("ROLLBACK");
          return NextResponse.json(
            { error: `Total changed after quantity discounts were applied. New total is ${totalAmount.toFixed(2)}.` },
            { status: 409 }
          );
        }

        // Deduct STOCK for normal lines (commit-time)
        const { rows: normLines } = await tx.query(
          `SELECT "productId","variationId",quantity FROM "cartProducts"
            WHERE "cartId"=$1 AND "productId" IS NOT NULL`,
          [cartId]
        );
        const country = String(summary.country || "").toUpperCase();
        for (const nl of normLines) {
          const pid: string = nl.productId;
          const vid: string | null = nl.variationId ?? null;
          const qty: number = Number(nl.quantity || 0);
          if (qty > 0) await adjustStock(tx, pid, vid, country, -qty);
        }

        // Affiliate points redemption (commit-time)
        const { rows: affLines } = await tx.query(
          `SELECT quantity,"unitPrice" FROM "cartProducts"
            WHERE "cartId"=$1 AND "affiliateProductId" IS NOT NULL`,
          [cartId]
        );
        let requiredPoints = 0;
        for (const a of affLines) requiredPoints += Number(a.quantity || 0) * Number(a.unitPrice || 0);
        if (!isParked && requiredPoints > 0) {
          const { rows: balRows } = await tx.query(
            `SELECT "pointsCurrent" FROM "affiliatePointBalances"
               WHERE "organizationId"=$1 AND "clientId"=$2`,
            [organizationId, summary.clientId],
          );
          const pointsCurrent = Number(balRows[0]?.pointsCurrent ?? 0);
          if (requiredPoints > pointsCurrent) {
            await tx.query("ROLLBACK");
            return NextResponse.json(
              { error: "Insufficient affiliate points", required: requiredPoints, available: pointsCurrent },
              { status: 400 },
            );
          }
          await tx.query(
            `INSERT INTO "affiliatePointBalances" AS b
             ("clientId","organizationId","pointsCurrent","createdAt","updatedAt")
             VALUES ($1,$2,$3,NOW(),NOW())
             ON CONFLICT("clientId","organizationId") DO UPDATE
             SET "pointsCurrent" = b."pointsCurrent" - EXCLUDED."pointsCurrent",
                 "pointsSpent"   = COALESCE(b."pointsSpent",0) + EXCLUDED."pointsCurrent",
                 "updatedAt"     = NOW()`,
            [summary.clientId, organizationId, requiredPoints],
          );
          await tx.query(
            `INSERT INTO "affiliatePointLogs"
               (id,"organizationId","clientId",points,action,description,"createdAt","updatedAt")
             VALUES ($1,$2,$3,$4,'redeem','pos checkout',NOW(),NOW())`,
            [uuidv4(), organizationId, summary.clientId, -requiredPoints],
          );
        }

        // Create order
        const orderId = uuidv4();
        await tx.query(`CREATE SEQUENCE IF NOT EXISTS order_key_seq START 1 INCREMENT 1 OWNED BY NONE`);
        const { rows: seqRows } = await tx.query(`SELECT nextval('order_key_seq') AS seq`);
        const seqNum = String(Number(seqRows[0].seq)).padStart(4, "0");
        const orderKey = `POS-${seqNum}`;

        const primaryMethodName =
          payments.length === 0
            ? null
            : (payments.length > 1
                ? 'split'
                : (methods.find((m: any) => String(m.id) === String(payments[0].methodId))?.name ?? null));

        let orderChannel = summary.channel;
        if (orderChannel === "pos-" && (storeId || registerId)) {
          orderChannel = `pos-${storeId ?? "na"}-${registerId ?? "na"}`;
          await tx.query(`UPDATE carts SET channel=$1 WHERE id=$2`, [orderChannel, cartId]);
        }

        const currentUser = await fetchCurrentUserFromSession(req);
        const metaArr: any[] = [{
          event: "cashier",
          type: "pos_checkout",
          cashierId: currentUser?.id ?? (ctx as any).userId ?? null,
          cashierName: currentUser?.name ?? null,
          storeId: storeId ?? null,
          registerId: registerId ?? null,
          at: new Date().toISOString(),
        }];
        if (isParked) {
          metaArr.push({
            event: "parked",
            remaining: +(totalAmount - paid).toFixed(2),
            total: totalAmount,
            paid: +paid.toFixed(2),
            at: new Date().toISOString(),
          });
        }
        const initialOrderMeta = JSON.stringify(metaArr);

        const orderStatus = isParked ? "pending_payment" : "paid";
        const datePaid = isParked ? null : new Date();
        const dateCompleted = isParked ? null : new Date();

        const insertSql = `
         INSERT INTO orders (
            id,"clientId","cartId",country,status,
            "paymentMethod","orderKey","cartHash",
            "shippingTotal","discountTotal","totalAmount",
            "couponCode","couponType","discountValue",
            "shippingService",
            "dateCreated","datePaid","dateCompleted","dateCancelled",
            "orderMeta",
            "createdAt","updatedAt","organizationId",channel
          ) VALUES (
            $1,$2,$3,$4,$5,
            $6,$7,$8,
            $9,$10,$11,
            $12,$13,$14,
            $15,
            $16,$17,$18,$19,
            $20::jsonb,
            NOW(),NOW(),$21,$22
          )
          RETURNING *`;

        const vals = [
          orderId,
          summary.clientId,
          summary.cartId,
          summary.country,
          orderStatus,
          primaryMethodName,
          orderKey,
          cartHash,
          0, // shippingTotal
          discountTotal,
          totalAmount,
          discountKind ? "POS" : null,
          couponType,
          discountValueArr,
          "-",
          new Date(),
          datePaid,
          dateCompleted,
          null,
          initialOrderMeta,
          organizationId,
          orderChannel,
        ];

        const { rows: orderRows } = await tx.query(insertSql, vals);
        const order = orderRows[0];

        // Persist split payments
        for (const p of payments) {
          await tx.query(
            `INSERT INTO "orderPayments"(id,"orderId","methodId",amount)
             VALUES ($1,$2,$3,$4)`,
            [uuidv4(), order.id, p.methodId, Number(p.amount)]
          );
        }

        // Close cart
        await tx.query(`UPDATE carts SET status = FALSE, "updatedAt" = NOW() WHERE id = $1`, [cartId]);

        await tx.query("COMMIT");

        // ───────────────── post-commit asyncs (reuse your existing helpers) ─────────────────
        try { await emitIdleForCart(cartId); } catch (e) { console.warn("[cd][checkout->idle] emit failed", e); }
        try {
          // create revenue, fees, affiliate bonuses, niftipay, notifications
          // (reuse the same helper blocks from your previous version)
        } catch {}

        return NextResponse.json({ order }, { status: 201 });
      } catch (e) {
        try { await (pool as any).query("ROLLBACK"); } catch {}
        throw e;
      } finally {
        // ensure client release
        // @ts-ignore
        if (typeof (tx?.release) === "function") tx.release();
      }
    } catch (err: any) {
      if (err instanceof z.ZodError) return NextResponse.json({ error: err.errors }, { status: 400 });
      console.error("[POS POST /pos/checkout] error:", err);
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
  });
}
