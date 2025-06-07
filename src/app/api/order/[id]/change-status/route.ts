// src/app/api/order/[id]/change-status/route.ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Pool } from "pg";
import { v4 as uuidv4 } from "uuid";
import { getContext } from "@/lib/context";
import { adjustStock } from "@/lib/stock";
import { sendNotification } from "@/lib/notifications";
import type { NotificationType } from "@/lib/notifications";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

/* ───────── helpers ───────── */
const ACTIVE   = ["open", "paid", "completed"]; // stock & points RESERVED
const INACTIVE = ["cancelled", "failed", "refunded"];      // stock & points RELEASED
const orderStatusSchema        = z.object({ status: z.string() });
/* record-the-date helper */
const DATE_COL_FOR_STATUS: Record<string, string | undefined> = {
  paid:       "datePaid",
  completed:  "dateCompleted",
  cancelled:  "dateCancelled",
  refunded:   "dateCancelled",   // choose whatever fits your flow
};
/**
 * Statuses that should trigger exactly one notification per order
 * life-cycle – “paid” & “completed“ behave as before.
 * “cancelled” is always announced.
 */
const FIRST_NOTIFY_STATUSES = ["paid", "completed"] as const;

const isActive   = (s: string) => ACTIVE.includes(s);
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

    const deltaCurrent =  pts;  // same sign as pts
    const deltaSpent   = -pts;  // opposite sign
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
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
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
              "cartId",
              "clientId",
              "orderKey",
              "notifiedPaidOrCompleted",
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
    const becameActive   =  isActive(newStatus)   && !isActive(ord.status);
    const becameInactive =  isInactive(newStatus) && !isInactive(ord.status);

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
        const pts   = -ord.pointsRedeemed;
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

    await client.query(
      `UPDATE orders
          SET ${sets.join(", ")}
        WHERE id = $2`,
      [newStatus, id],
    );



    /* ─────────────────────────────────────────────
     *  Notification logic
     * ───────────────────────────────────────────── */
    let shouldNotify = false;

    /* —— NEW order placed check —— */               // NEW ⬅︎
    if (newStatus === "open" && ord.status !== "open") { // NEW ⬅︎
      shouldNotify = true;                              // NEW ⬅︎
    }                                                   // NEW ⬅︎
    else if (FIRST_NOTIFY_STATUSES.includes(            // existing logic
             newStatus as (typeof FIRST_NOTIFY_STATUSES)[number])) {
      shouldNotify = !ord.notifiedPaidOrCompleted;
    } else if (newStatus === "cancelled" || newStatus === "refunded") {
      shouldNotify = true;
    }

    if (shouldNotify) {
      /* build product list */
      const { rows: prodRows } = await client.query(
        `SELECT cp.quantity, p.title
           FROM "cartProducts" cp
           JOIN products p ON p.id = cp."productId"
          WHERE cp."cartId" = $1`,
        [ord.cartId],
      );
      const productList = prodRows
        .map((pr) => `x${pr.quantity} ${pr.title}`)
        .join("<br>");

      /* map status → notification type */
      const notifTypeMap: Record<string, NotificationType> = {
        open:       "order_placed",   // NEW ⬅︎
        paid:       "order_paid",
        completed:  "order_completed",
        cancelled:  "order_cancelled",
        refunded:  "order_refunded",
      } as const;
      const notifType: NotificationType =
        notifTypeMap[newStatus] || "order_ready";

      await sendNotification({
        organizationId,
        type: notifType,
        subject: `Order #${ord.orderKey} ${newStatus}`,
        message: `Your order status is now <b>${newStatus}</b><br>{product_list}`,
        country: ord.country,
        trigger: "order_status_change",
        channels: ["email", "in_app", "telegram"],
        clientId: ord.clientId,
        variables: { product_list: productList, order_key: ord.orderKey },
      });

      /* mark as sent for paid/completed so we don’t double-notify */
      if (FIRST_NOTIFY_STATUSES.includes(
            newStatus as (typeof FIRST_NOTIFY_STATUSES)[number])) {
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
