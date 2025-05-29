// src/app/api/order/[id]/change-status/route.ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Pool } from "pg";
import { v4 as uuidv4 } from "uuid";
import { getContext } from "@/lib/context";
import { adjustStock } from "@/lib/stock";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const orderStatusSchema = z.object({ status: z.string() });

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

    /* 1️⃣ lock the order + fetch redeemed */
    const ordRes = await client.query(
      `SELECT status, country, "cartId", "clientId",
              COALESCE("pointsRedeemed",0) AS "pointsRedeemed"
         FROM orders
        WHERE id = $1
          FOR UPDATE`,
      [id]
    );
    if (!ordRes.rowCount) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }
    const ord = ordRes.rows[0];

    /* 2️⃣ → "open": reserve stock & spend affiliate & redeemed points */
    const mustDeduct = newStatus === "open" && ord.status !== "open";
    if (mustDeduct) {
      const { rows: items } = await client.query(
        `SELECT cp."productId", cp."affiliateProductId", cp.quantity, cp."unitPrice"
           FROM "cartProducts" cp WHERE cp."cartId" = $1`,
        [ord.cartId]
      );
      for (const it of items) {
        if (it.productId)
          await adjustStock(client, it.productId, ord.country, -it.quantity);
        if (it.affiliateProductId)
          await adjustStock(client, it.affiliateProductId, ord.country, -it.quantity);

        if (it.affiliateProductId) {
          const ptsSpent = it.unitPrice * it.quantity;
          const logId = uuidv4();
          await client.query(
            `INSERT INTO "affiliatePointLogs"
               (id,"organizationId","clientId",points,action,description,"createdAt","updatedAt")
             VALUES($1,$2,$3,$4,'purchase_affiliate','Spent on affiliate purchase',NOW(),NOW())`,
            [logId, organizationId, ord.clientId, -ptsSpent]
          );
          await client.query(
            `INSERT INTO "affiliatePointBalances"
               ("clientId","organizationId","pointsCurrent","pointsSpent","createdAt","updatedAt")
             VALUES($1,$2,$3,$4,NOW(),NOW())
             ON CONFLICT("clientId","organizationId") DO UPDATE
               SET "pointsCurrent" = "affiliatePointBalances"."pointsCurrent" + EXCLUDED."pointsCurrent",
                   "pointsSpent"   = "affiliatePointBalances"."pointsSpent"   + EXCLUDED."pointsSpent",
                   "updatedAt"     = NOW()`,
            [ord.clientId, organizationId, 0, ptsSpent]
          );
        }
      }
      // — Deduct redeemed points —
      const ptsRedeemed = ord.pointsRedeemed;
      if (ptsRedeemed > 0) {
        const logId2 = uuidv4();
        await client.query(
          `INSERT INTO "affiliatePointLogs"
             (id,"organizationId","clientId",points,action,description,"createdAt","updatedAt")
           VALUES($1,$2,$3,$4,'redeem_points','Redeemed points for discount',NOW(),NOW())`,
          [logId2, organizationId, ord.clientId, -ptsRedeemed]
        );
        await client.query(
          `INSERT INTO "affiliatePointBalances"
             ("clientId","organizationId","pointsCurrent","pointsSpent","createdAt","updatedAt")
           VALUES($1,$2,$3,$4,NOW(),NOW())
           ON CONFLICT("clientId","organizationId") DO UPDATE
             SET "pointsCurrent" = "affiliatePointBalances"."pointsCurrent" + EXCLUDED."pointsCurrent",
                 "pointsSpent"   = "affiliatePointBalances"."pointsSpent"   + EXCLUDED."pointsSpent",
                 "updatedAt"     = NOW()`,
          [ord.clientId, organizationId, 0, ptsRedeemed]
        );
      }
    }

    /* 3️⃣ → "cancelled"/"failed": release & refund affiliate & redeemed */
    const mustReturn =
      ["cancelled", "failed"].includes(newStatus) &&
      !["cancelled", "failed"].includes(ord.status);
    if (mustReturn) {
      const { rows: items } = await client.query(
        `SELECT cp."productId", cp."affiliateProductId", cp.quantity, cp."unitPrice"
           FROM "cartProducts" cp WHERE cp."cartId" = $1`,
        [ord.cartId]
      );
      for (const it of items) {
        if (it.productId)
          await adjustStock(client, it.productId, ord.country, it.quantity);
        if (it.affiliateProductId)
          await adjustStock(client, it.affiliateProductId, ord.country, it.quantity);

        if (it.affiliateProductId) {
          const ptsRefund = it.unitPrice * it.quantity;
          const logId = uuidv4();
          await client.query(
            `INSERT INTO "affiliatePointLogs"
               (id,"organizationId","clientId",points,action,description,"createdAt","updatedAt")
             VALUES($1,$2,$3,$4,'refund_affiliate','Refund on cancelled order',NOW(),NOW())`,
            [logId, organizationId, ord.clientId, ptsRefund]
          );
          await client.query(
            `INSERT INTO "affiliatePointBalances"
               ("clientId","organizationId","pointsCurrent","pointsSpent","createdAt","updatedAt")
             VALUES($1,$2,$3,$4,NOW(),NOW())
             ON CONFLICT("clientId","organizationId") DO UPDATE
  SET "pointsCurrent" = "affiliatePointBalances"."pointsCurrent"
                        + EXCLUDED."pointsCurrent",
      /* prevent negatives ↓ */
      "pointsSpent"   = GREATEST(
                          "affiliatePointBalances"."pointsSpent"
                          + EXCLUDED."pointsSpent", 0
                        ),
      "updatedAt"     = NOW()
`,
            [ord.clientId, organizationId, ptsRefund, -ptsRefund]
          );
        }
      }
      // — Refund redeemed points —
      const ptsRedeemed = ord.pointsRedeemed;
      if (ptsRedeemed > 0) {
        const logId2 = uuidv4();
        await client.query(
          `INSERT INTO "affiliatePointLogs"
             (id,"organizationId","clientId",points,action,description,"createdAt","updatedAt")
           VALUES($1,$2,$3,$4,'refund_redeemed_points','Refund redeemed points on cancelled order',NOW(),NOW())`,
          [logId2, organizationId, ord.clientId, ptsRedeemed]
        );
        await client.query(
          `INSERT INTO "affiliatePointBalances"
             ("clientId","organizationId","pointsCurrent","pointsSpent","createdAt","updatedAt")
           VALUES($1,$2,$3,$4,NOW(),NOW())
           ON CONFLICT("clientId","organizationId") DO UPDATE
  SET "pointsCurrent" = "affiliatePointBalances"."pointsCurrent"
                        + EXCLUDED."pointsCurrent",
      /* prevent negatives ↓ */
      "pointsSpent"   = GREATEST(
                          "affiliatePointBalances"."pointsSpent"
                          + EXCLUDED."pointsSpent", 0
                        ),
      "updatedAt"     = NOW()
`,
          [ord.clientId, organizationId, ptsRedeemed, -ptsRedeemed]
        );
      }
    }

    /* 4️⃣ finalize status change */
    await client.query(
      `UPDATE orders SET status = $1, "updatedAt" = NOW() WHERE id = $2`,
      [newStatus, id]
    );

    await client.query("COMMIT");
    return NextResponse.json({ id, status: newStatus });
  } catch (e) {
    await client.query("ROLLBACK");
    console.error(e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  } finally {
    client.release();
  }
}
