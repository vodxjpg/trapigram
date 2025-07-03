// src/app/api/order/[id]/change-status/route.ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { pgPool as pool } from "@/lib/db";;
import { v4 as uuidv4 } from "uuid";
import { getContext } from "@/lib/context";
import { adjustStock } from "@/lib/stock";
import { sendNotification } from "@/lib/notifications";
import type { NotificationType } from "@/lib/notifications";
import { getRevenue } from "@/lib/revenue";




/* ───────── helpers ───────── */
/** Stock & points stay RESERVED while the order is *underpaid*. */
const ACTIVE = ["open", "underpaid", "paid", "completed"]; // stock & points RESERVED
const INACTIVE = ["cancelled", "failed", "refunded"];      // stock & points RELEASED
const orderStatusSchema = z.object({ status: z.string() });
/* record-the-date helper */
const DATE_COL_FOR_STATUS: Record<string, string | undefined> = {
  underpaid: "dateUnderpaid",
  paid: "datePaid",
  completed: "dateCompleted",
  cancelled: "dateCancelled",
  refunded: "dateCancelled",   // choose whatever fits your flow
};
/**
 * Statuses that should trigger exactly one notification per order
 * life-cycle – “paid” & “completed“ behave as before.
 * “cancelled” is always announced.
 */
const FIRST_NOTIFY_STATUSES = ["paid", "completed"] as const
const isActive = (s: string) => ACTIVE.includes(s);
const isInactive = (s: string) => INACTIVE.includes(s);

/* ——— stock / points helper (unchanged) ——— */
async function applyItemEffects(
  c: Pool,
  effectSign: 1 | -1,              // +1 refund  |  -1 charge
  country: string,
  organizationId: string,
  clientId: string,
  item: {
    productId: string | null;
    affiliateProductId: string | null;
    quantity: number;
    unitPrice: number;
  },
  actionForLog: string,
  descrForLog: string,
) {
  /* stock --------------------------------------------------------- */
  if (item.productId)
    await adjustStock(c, item.productId, country, effectSign * item.quantity);
  if (item.affiliateProductId)
    await adjustStock(
      c,
      item.affiliateProductId,
      country,
      effectSign * item.quantity,
    );

  /* points -------------------------------------------------------- */
  if (item.affiliateProductId) {
    const pts = item.unitPrice * item.quantity * effectSign; // charge = −, refund = +
    const logId = uuidv4();
    await c.query(
      `INSERT INTO "affiliatePointLogs"
         (id,"organizationId","clientId",points,action,description,"createdAt","updatedAt")
       VALUES($1,$2,$3,$4,$5,$6,NOW(),NOW())`,
      [logId, organizationId, clientId, pts, actionForLog, descrForLog],
    );

    const deltaCurrent = pts;  // same sign as pts
    const deltaSpent = -pts;  // opposite sign
    await c.query(
      `INSERT INTO "affiliatePointBalances"
         ("clientId","organizationId","pointsCurrent","pointsSpent","createdAt","updatedAt")
       VALUES($1,$2,$3,$4,NOW(),NOW())
       ON CONFLICT("clientId","organizationId") DO UPDATE
         SET "pointsCurrent" = "affiliatePointBalances"."pointsCurrent" + EXCLUDED."pointsCurrent",
             "pointsSpent"   = GREATEST(
                                 "affiliatePointBalances"."pointsSpent" + EXCLUDED."pointsSpent",
                                 0
                               ),
             "updatedAt"     = NOW()`,
      [clientId, organizationId, deltaCurrent, deltaSpent],
    );
  }
}

/* ────────────────────────────────────────────────────────────── */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  // 1) context + permission guard
  const ctx = await getContext(req) as { organizationId: string };
  const { organizationId } = ctx;
  const { id } = await params;
  const { status: newStatus } = orderStatusSchema.parse(await req.json());

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    /* 1️⃣ lock order row */
    const {
      rows: [ord],
    } = await client.query(
      `SELECT status,
              country,
              "trackingNumber",
              "cartId",
              "clientId",
              "shippingService",
              "orderKey",
              "dateCreated",
              "shippingMethod",
              "notifiedPaidOrCompleted",
              "orderMeta",
              COALESCE("pointsRedeemed",0) AS "pointsRedeemed"
         FROM orders
        WHERE id = $1
          FOR UPDATE`,
      [id],
    );

    if (!ord) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }

    /* 2️⃣ determine transition */
    const becameActive = isActive(newStatus) && !isActive(ord.status);
    const becameInactive = isInactive(newStatus) && !isInactive(ord.status);

    /* 3️⃣ fetch cart lines once (if needed) */
    let lines: any[] = [];
    if (becameActive || becameInactive) {
      const res = await client.query(
        `SELECT "productId","affiliateProductId",quantity,"unitPrice"
           FROM "cartProducts"
          WHERE "cartId" = $1`,
        [ord.cartId],
      );
      lines = res.rows;
    }

    /* 4️⃣ ACTIVE   → reserve stock & charge points */
    if (becameActive) {
      for (const it of lines)
        await applyItemEffects(
          client,
          -1, // charge
          ord.country,
          organizationId,
          ord.clientId,
          it,
          "purchase_affiliate",
          "Spent on affiliate purchase",
        );

      /* redeem-discount points (charge) */
      if (ord.pointsRedeemed > 0) {
        const pts = -ord.pointsRedeemed;
        const logId = uuidv4();
        await client.query(
          `INSERT INTO "affiliatePointLogs"
             (id,"organizationId","clientId",points,action,description,"createdAt","updatedAt")
           VALUES($1,$2,$3,$4,'redeem_points','Redeemed points for discount',NOW(),NOW())`,
          [logId, organizationId, ord.clientId, pts],
        );
        await client.query(
          `INSERT INTO "affiliatePointBalances"
             ("clientId","organizationId","pointsCurrent","pointsSpent","createdAt","updatedAt")
           VALUES($1,$2,$3,$4,NOW(),NOW())
           ON CONFLICT("clientId","organizationId") DO UPDATE
             SET "pointsCurrent" = "affiliatePointBalances"."pointsCurrent" + EXCLUDED."pointsCurrent",
                 "pointsSpent"   = "affiliatePointBalances"."pointsSpent"   + EXCLUDED."pointsSpent",
                 "updatedAt"     = NOW()`,
          [ord.clientId, organizationId, -ord.pointsRedeemed, ord.pointsRedeemed],
        );
      }
    }

    /* 5️⃣ INACTIVE → release stock & refund points */
    if (becameInactive) {
      for (const it of lines)
        await applyItemEffects(
          client,
          +1, // refund
          ord.country,
          organizationId,
          ord.clientId,
          it,
          "refund_affiliate",
          "Refund on cancelled order",
        );

      /* refund redeemed-discount points */
      if (ord.pointsRedeemed > 0) {
        const logId = uuidv4();
        await client.query(
          `INSERT INTO "affiliatePointLogs"
             (id,"organizationId","clientId",points,action,description,"createdAt","updatedAt")
           VALUES($1,$2,$3,$4,'refund_redeemed_points','Refund redeemed points on cancelled order',NOW(),NOW())`,
          [logId, organizationId, ord.clientId, ord.pointsRedeemed],
        );
        await client.query(
          `INSERT INTO "affiliatePointBalances"
             ("clientId","organizationId","pointsCurrent","pointsSpent","createdAt","updatedAt")
           VALUES($1,$2,$3,$4,NOW(),NOW())
           ON CONFLICT("clientId","organizationId") DO UPDATE
             SET "pointsCurrent" = "affiliatePointBalances"."pointsCurrent" + EXCLUDED."pointsCurrent",
                 "pointsSpent"   = GREATEST(
                                     "affiliatePointBalances"."pointsSpent" + EXCLUDED."pointsSpent",
                                     0
                                   ),
                 "updatedAt"     = NOW()`,
          [ord.clientId, organizationId, ord.pointsRedeemed, -ord.pointsRedeemed],
        );
      }
    }

    /* 6️⃣ finally update order status */
    const dateCol = DATE_COL_FOR_STATUS[newStatus];

    /* build the dynamic SET-clause */
    const sets: string[] = [
      `status = $1`,
      `"updatedAt" = NOW()`,
    ];
    if (dateCol) {
      sets.splice(1, 0, `"${dateCol}" = COALESCE("${dateCol}", NOW())`);
      // COALESCE keeps an existing timestamp if it was already set
    }

    console.log(`Updating order ${id} from ${ord.status} to ${newStatus}`);
    await client.query(
      `UPDATE orders
      SET ${sets.join(", ")}
    WHERE id = $2`,
      [newStatus, id],
    );
    console.log(`Order ${id} updated to ${newStatus}`);
    await client.query("COMMIT");
    console.log(`Transaction committed for order ${id}`);

    // ─── trigger revenue update for paid orders ───
    if (newStatus === "paid") {
      try {
        // call getRevenue with order ID and organization ID
        await getRevenue(id, organizationId);
        console.log(`Revenue updated for order ${id}`);
      } catch (revErr) {
        console.error(`Failed to update revenue for order ${id}:`, revErr);
      }
    }




    /* ─────────────────────────────────────────────
     *  Notification logic
     * ───────────────────────────────────────────── */
    let shouldNotify = false;

    /* —— NEW order placed check —— */               // NEW ⬅︎
    if (newStatus === "open" && ord.status !== "open") { // NEW ⬅︎
      shouldNotify = true;                              // NEW ⬅︎
    }                                                   // NEW ⬅︎
    else if (newStatus === "underpaid") {
      shouldNotify = true;                     // notify always on first underpaid
    } else if (FIRST_NOTIFY_STATUSES.includes(
      newStatus as (typeof FIRST_NOTIFY_STATUSES)[number])) {
      shouldNotify = !ord.notifiedPaidOrCompleted;
    } else if (newStatus === "cancelled" || newStatus === "refunded") {
      shouldNotify = true;
    }

    if (shouldNotify) {
      /* build product list (normal and  affiliate) */
      const { rows: prodRows } = await client.query(
        `
      SELECT
        cp.quantity,
        COALESCE(p.title, ap.title)                             AS title,
        COALESCE(cat.name, 'Uncategorised')                     AS category
      FROM "cartProducts" cp
      /* normal products ---------------------------------------- */
      LEFT JOIN products p              ON p.id  = cp."productId"
      /* affiliate products ------------------------------------- */
      LEFT JOIN "affiliateProducts" ap  ON ap.id = cp."affiliateProductId"
      /* category (first one found) ----------------------------- */
      LEFT JOIN "productCategory" pc    ON pc."productId" = COALESCE(p.id, ap.id)
      LEFT JOIN "productCategories" cat ON cat.id = pc."categoryId"
      WHERE cp."cartId" = $1
      ORDER BY category, title
    `,
        [ord.cartId],
      );
      /* ✨ group by category */
      const grouped: Record<string, { q: number; t: string }[]> = {};
      for (const r of prodRows) {
        grouped[r.category] ??= [];
        grouped[r.category].push({ q: r.quantity, t: r.title });
      }

      const productList = Object.entries(grouped)
        .map(([cat, items]) => {
          const lines = items
            .map((it) => `- x${it.q} ${it.t}`)
            .join("<br>");
          return `<b>${cat.toUpperCase()}</b><br>${lines}`;
        })
        .join("<br><br>");

      /* map status → notification type */
      /* ── gather extra variables for the “underpaid” e-mail ───────────── */
      let receivedAmt = "";
      let expectedAmt = "";
      let assetSymbol = "";
      if (newStatus === "underpaid") {
        try {
          /* orderMeta can arrive as JSON **object** (pg-json) or string — normalise */
          const metaArr =
            Array.isArray(ord.orderMeta)
              ? ord.orderMeta
              : JSON.parse(ord.orderMeta ?? "[]");

          const latest = [...metaArr]
            .reverse()
            .find((m: any) => (m.event ?? "").toLowerCase() === "underpaid");

          receivedAmt = latest?.order?.received ?? "";
          expectedAmt = latest?.order?.expected ?? "";
          assetSymbol = latest?.order?.asset ?? "";
        } catch {
          /* leave placeholders empty on malformed data */
        }
      }

      const pendingAmt =
        receivedAmt && expectedAmt
          ? String(Number(expectedAmt) - Number(receivedAmt))
          : "";

      const notifTypeMap: Record<string, NotificationType> = {
        open: "order_placed",
        underpaid: "order_partially_paid",   // NEW ⬅︎
        paid: "order_paid",
        completed: "order_completed",
        cancelled: "order_cancelled",
        refunded: "order_refunded",
      } as const;
      const notifType: NotificationType =
        notifTypeMap[newStatus] || "order_ready";

      const orderDate = new Date(ord.dateCreated).toLocaleDateString("en-GB");

      await sendNotification({
        organizationId,
        type: notifType,
        subject: `Order #${ord.orderKey} ${newStatus}`,
        message:
          `Your order status is now <b>${newStatus}</b><br>{product_list}`,
        country: ord.country,
        trigger: "order_status_change",
        channels: ["email", "in_app", "telegram"],
        clientId: ord.clientId,
        variables: {
          product_list: productList,
          order_number: ord.orderKey,
          order_date: orderDate,
          order_shipping_method: ord.shippingMethod ?? "-",
          tracking_number: ord.trackingNumber ?? "",
          expected_amt: expectedAmt,        // ★ NEW
          received_amt: receivedAmt,
          shipping_company: ord.shippingService ?? "",
          pending_amt: pendingAmt,
          asset: assetSymbol,        // ★ NEW
        },
      });

      /* mark flag only for paid / completed (NOT underpaid) */
      if (newStatus === "completed") {
        await client.query(
          `UPDATE orders
              SET "notifiedPaidOrCompleted" = true,
                  "updatedAt" = NOW()
            WHERE id = $1`,
          [id],
        );
      }
    }

    await client.query("COMMIT");
    return NextResponse.json({ id, status: newStatus });
  } catch (e) {
    await client.query("ROLLBACK");
    console.error("[PATCH /api/order/:id/change-status]", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  } finally {
    client.release();
  }
}
