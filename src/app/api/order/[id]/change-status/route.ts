import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Pool } from "pg";
import { getContext } from "@/lib/context";

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
});

// Updated coupon update schema with new field "expendingMinimum"
const orderStatusSchema = z.object({
    status: z.string()
});

export async function PATCH(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> },
  ) {
    const ctx = await getContext(req);
    if (ctx instanceof NextResponse) return ctx;
  
    const { id } = await params;
    const { status: newStatus } = await req.json();   // already validated above
  
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
  
      /* 1️⃣  lock the order we’re changing */
      const ordRes = await client.query(
        `SELECT status,country,"cartId" FROM orders WHERE id = $1 FOR UPDATE`,
        [id]
      );
      if (!ordRes.rowCount) {
        await client.query("ROLLBACK");
        return NextResponse.json({ error: "Order not found" }, { status: 404 });
      }
      const ord = ordRes.rows[0];
  
      /* 2️⃣  if going -> cancelled/failed, put stock back */
      const mustReturn = ["cancelled", "failed"].includes(newStatus)
                         && !["cancelled", "failed"].includes(ord.status);
  
      if (mustReturn) {
        const lnSql = `
          SELECT cp."productId", cp.quantity,
                 p."stockData", p."manageStock"
          FROM   "cartProducts" cp
          JOIN   products p ON p.id = cp."productId"
          WHERE  cp."cartId" = $1
        `;
        const { rows: ln } = await client.query(lnSql, [ord.cartId]);
  
        for (const l of ln) {
          if (!l.manageStock) continue;
          /* put everything back into the FIRST warehouse entry we find */
          const whId = Object.keys(l.stockData ?? {})[0];
          if (!whId) continue;
  
          const current = (l.stockData[whId]?.[ord.country] ?? 0) as number;
          await client.query(
            `UPDATE products
             SET "stockData" = jsonb_set(
               "stockData",
               ARRAY[$1,$2],
               to_jsonb((($3)::int) + $4)
             )
             WHERE id = $5`,
            [whId, ord.country, current, l.quantity, l.productId]
          );
        }
      }
  
      /* 3️⃣  final order status update */
      await client.query(
        `UPDATE orders
         SET status = $1, "updatedAt" = NOW()
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
  