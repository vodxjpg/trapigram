// src/app/api/order/[id]/change-status/route.ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Pool } from "pg";
import { v4 as uuidv4 } from "uuid";
import { getContext } from "@/lib/context";
import { adjustStock } from "@/lib/stock";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

const orderStatusSchema = z.object({
  status: z.string(),
});

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

    /* 1️⃣ lock the order */
    const ordRes = await client.query(
      `SELECT status, country, "cartId", "clientId"
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

    /* 2️⃣ when moving → "open", reserve stock & spend affiliate points */
    const mustDeduct =
      newStatus === "open" &&
      ord.status !== "open";

    if (mustDeduct) {
      const { rows: items } = await client.query(
        `SELECT cp."productId",
                cp."affiliateProductId",
                cp.quantity,
                cp."unitPrice"
           FROM "cartProducts" cp
          WHERE cp."cartId" = $1`,
        [ord.cartId]
      );

      for (const it of items) {
        // ––– reserve real product stock
        if (it.productId) {
          await adjustStock(client, it.productId, ord.country, -it.quantity);
        }
        // ––– reserve affiliate product stock
        if (it.affiliateProductId) {
          await adjustStock(client, it.affiliateProductId, ord.country, -it.quantity);
        }
        // ––– spend affiliate points
        if (it.affiliateProductId) {
          const ptsSpent = it.unitPrice * it.quantity;
          const logId = uuidv4();
          // log the spending
          await client.query(
            `INSERT INTO "affiliatePointLogs"
               (id,"organizationId","clientId",points,action,description,"createdAt","updatedAt")
             VALUES($1,$2,$3,$4,'purchase_affiliate','Spent on affiliate purchase',NOW(),NOW())`,
            [logId, organizationId, ord.clientId, -ptsSpent]
          );
          // update balances
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
    }

    /* 3️⃣ when moving → "cancelled"|"failed", release stock & refund points */
    const mustReturn =
      ["cancelled", "failed"].includes(newStatus) &&
      !["cancelled", "failed"].includes(ord.status);

    if (mustReturn) {
      const { rows: items } = await client.query(
        `SELECT cp."productId",
                cp."affiliateProductId",
                cp.quantity,
                cp."unitPrice"
           FROM "cartProducts" cp
          WHERE cp."cartId" = $1`,
        [ord.cartId]
      );

      for (const it of items) {
        // ––– release real product stock
        if (it.productId) {
          await adjustStock(client, it.productId, ord.country, it.quantity);
        }
        // ––– release affiliate product stock
        if (it.affiliateProductId) {
          await adjustStock(client, it.affiliateProductId, ord.country, it.quantity);
        }
        // ––– refund affiliate points
        if (it.affiliateProductId) {
          const ptsRefund = it.unitPrice * it.quantity;
          const logId = uuidv4();
          // log the refund
          await client.query(
            `INSERT INTO "affiliatePointLogs"
               (id,"organizationId","clientId",points,action,description,"createdAt","updatedAt")
             VALUES($1,$2,$3,$4,'refund_affiliate','Refund on cancelled order',NOW(),NOW())`,
            [logId, organizationId, ord.clientId, ptsRefund]
          );
          // reverse the previous balance update
          await client.query(
            `INSERT INTO "affiliatePointBalances"
               ("clientId","organizationId","pointsCurrent","pointsSpent","createdAt","updatedAt")
             VALUES($1,$2,$3,$4,NOW(),NOW())
             ON CONFLICT("clientId","organizationId") DO UPDATE
               SET "pointsCurrent" = "affiliatePointBalances"."pointsCurrent" + EXCLUDED."pointsCurrent",
                   "pointsSpent"   = "affiliatePointBalances"."pointsSpent"   + EXCLUDED."pointsSpent",
                   "updatedAt"     = NOW()`,
            // credit current, debit spent
            [ord.clientId, organizationId, ptsRefund, -ptsRefund]
          );
        }
      }
    }

    /* 4️⃣ finalize status change */
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
    console.error(e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  } finally {
    client.release();
  }
}
