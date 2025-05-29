// src/app/api/order/[id]/change-status/route.ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Pool } from "pg";
import { v4 as uuidv4 } from "uuid";
import { getContext } from "@/lib/context";
import { adjustStock } from "@/lib/stock";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

/* ───────── helpers ───────── */
const ACTIVE  = ["open", "paid", "completed"];     // stock & points RESERVED
const INACTIVE = ["cancelled", "failed"];          // stock & points RELEASED
const orderStatusSchema = z.object({ status: z.string() });

const isActive   = (s: string) => ACTIVE.includes(s);
const isInactive = (s: string) => INACTIVE.includes(s);

/**
 * ± qty   :  stock delta (- reserve, + release)
 * ± points:  current  ↔ spent  balance adjustment
 *            +pointsCurrent / –pointsSpent   … refund
 *            –pointsCurrent / +pointsSpent   … charge
 */
async function applyItemEffects(
  c: Pool,
  effectSign: 1 | -1,          // +1 refund || -1 charge
  country: string,
  organizationId: string,
  clientId: string,
  item: { productId: string | null; affiliateProductId: string | null; quantity: number; unitPrice: number; },
  actionForLog: string,
  descrForLog: string,
) {
  /* stock --------------------------------------------------------- */
  if (item.productId)
    await adjustStock(c, item.productId,  country,  effectSign * item.quantity);
  if (item.affiliateProductId)
    await adjustStock(c, item.affiliateProductId,  country,  effectSign * item.quantity);

  /* points -------------------------------------------------------- */
  if (item.affiliateProductId) {
    const pts = item.unitPrice * item.quantity * effectSign;      // charge=- , refund=+
    const logId = uuidv4();
    await c.query(
      `INSERT INTO "affiliatePointLogs"
         (id,"organizationId","clientId",points,action,description,"createdAt","updatedAt")
       VALUES($1,$2,$3,$4,$5,$6,NOW(),NOW())`,
      [logId, organizationId, clientId, pts, actionForLog, descrForLog]
    );

    const deltaCurrent =  pts;              // same sign as pts
    const deltaSpent   = -pts;              // opposite sign
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
      [clientId, organizationId, deltaCurrent, deltaSpent]
    );
  }
}

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
    const { rows: [ord] } = await client.query(
      `SELECT status, country, "cartId", "clientId",
              COALESCE("pointsRedeemed",0) AS "pointsRedeemed"
         FROM orders
        WHERE id = $1
          FOR UPDATE`,
      [id]
    );
    if (!ord) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }

    /* 2️⃣ determine transition ------------------------------------ */
    const becameActive   =  isActive(newStatus)   && !isActive(ord.status);
    const becameInactive =  isInactive(newStatus) && !isInactive(ord.status);

    /* 3️⃣ fetch cart lines once (if needed) ----------------------- */
    let lines: any[] = [];
    if (becameActive || becameInactive) {
      const res = await client.query(
        `SELECT "productId","affiliateProductId",quantity,"unitPrice"
           FROM "cartProducts"
          WHERE "cartId" = $1`,
        [ord.cartId]
      );
      lines = res.rows;
    }

    /* 4️⃣ ACTIVE   → reserve stock & charge points --------------- */
    if (becameActive) {
      for (const it of lines)
        await applyItemEffects(
          client,
          -1,                   // charge
          ord.country,
          organizationId,
          ord.clientId,
          it,
          "purchase_affiliate",
          "Spent on affiliate purchase"
        );

      /* redeem-discount points */
      if (ord.pointsRedeemed > 0) {
        const pts = -ord.pointsRedeemed; 
        const logId = uuidv4();
        await client.query(
          `INSERT INTO "affiliatePointLogs"
             (id,"organizationId","clientId",points,action,description,"createdAt","updatedAt")
           VALUES($1,$2,$3,$4,'redeem_points','Redeemed points for discount',NOW(),NOW())`,
          [logId, organizationId, ord.clientId, pts]
        );
       await client.query(
           `INSERT INTO "affiliatePointBalances"
              ("clientId","organizationId","pointsCurrent","pointsSpent","createdAt","updatedAt")
            VALUES($1,$2,$3,$4,NOW(),NOW())
            ON CONFLICT("clientId","organizationId") DO UPDATE
              SET "pointsCurrent" = "affiliatePointBalances"."pointsCurrent" + EXCLUDED."pointsCurrent",
                  "pointsSpent"   = "affiliatePointBalances"."pointsSpent"   + EXCLUDED."pointsSpent",
                  "updatedAt"     = NOW()`,
           [ord.clientId, organizationId, -ord.pointsRedeemed,  ord.pointsRedeemed]
         );
      }
    }

    /* 5️⃣ INACTIVE → release stock & refund points --------------- */
    if (becameInactive) {
      for (const it of lines)
        await applyItemEffects(
          client,
          +1,                  // refund
          ord.country,
          organizationId,
          ord.clientId,
          it,
          "refund_affiliate",
          "Refund on cancelled order"
        );

      if (ord.pointsRedeemed > 0) {
        const logId = uuidv4();
        await client.query(
          `INSERT INTO "affiliatePointLogs"
             (id,"organizationId","clientId",points,action,description,"createdAt","updatedAt")
           VALUES($1,$2,$3,$4,'refund_redeemed_points','Refund redeemed points on cancelled order',NOW(),NOW())`,
          [logId, organizationId, ord.clientId, ord.pointsRedeemed]
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
          [ord.clientId, organizationId, ord.pointsRedeemed, -ord.pointsRedeemed]
        );
      }
    }

    /* 6️⃣ finally update order status ---------------------------- */
    await client.query(
      `UPDATE orders
          SET status = $1,
              "updatedAt" = NOW()
        WHERE id = $2`,
      [newStatus, id]
    );

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
