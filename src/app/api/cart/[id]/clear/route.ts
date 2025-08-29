// src/app/api/cart/[id]/clear/route.ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { pgPool as pool } from "@/lib/db";
import { getContext } from "@/lib/context";
import { adjustStock } from "@/lib/stock";
import crypto from "crypto";

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { organizationId } = ctx;

  try {
    const { id } = await params;

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // who/where (for stock + refund targets)
      const { rows: metaRows } = await client.query(
        `SELECT cl."country", ca."clientId"
           FROM carts ca
           JOIN clients cl ON cl.id = ca."clientId"
          WHERE ca.id = $1`,
        [id],
      );
      if (!metaRows.length) {
        await client.query("ROLLBACK");
        return NextResponse.json({ error: "Cart not found" }, { status: 404 });
      }
      const country  = metaRows[0].country as string;
      const clientId = metaRows[0].clientId as string;

      // delete all lines but keep them for refunds/stock
      const { rows: deleted } = await client.query(
        `DELETE FROM "cartProducts"
          WHERE "cartId" = $1
      RETURNING "productId","affiliateProductId",quantity,"unitPrice"`,
        [id],
      );

      // restore stock for normal products
      for (const line of deleted) {
        if (line.productId) {
          // positive delta → give stock back
          await adjustStock(
            client,
            String(line.productId),
            country,
            Number(line.quantity) || 0,
          );
        }
      }

      // aggregate affiliate-points refund
      const refundedPoints = deleted
        .filter((l) => l.affiliateProductId)
        .reduce(
          (sum, l) => sum + Number(l.quantity) * Number(l.unitPrice),
          0,
        );

      if (refundedPoints > 0) {
        await client.query(
          `UPDATE "affiliatePointBalances"
              SET "pointsCurrent" = "pointsCurrent" + $1,
                  "pointsSpent"   = GREATEST("pointsSpent" - $1, 0),
                  "updatedAt"     = NOW()
            WHERE "organizationId" = $2 AND "clientId" = $3`,
          [refundedPoints, organizationId, clientId],
        );
        await client.query(
          `INSERT INTO "affiliatePointLogs"
             (id,"organizationId","clientId",points,action,description,"createdAt","updatedAt")
           VALUES (gen_random_uuid(),$1,$2,$3,'refund','cart cleared',NOW(),NOW())`,
          [organizationId, clientId, refundedPoints],
        );
      }

      // set cart hash to "empty cart" (same as new-cart initial state)
      const emptyHash = crypto
        .createHash("sha256")
        .update(JSON.stringify([]))
        .digest("hex");
      await client.query(
        `UPDATE carts
            SET "cartUpdatedHash" = $1,
                "updatedAt"       = NOW()
          WHERE id = $2`,
        [emptyHash, id],
      );

      await client.query("COMMIT");
      return NextResponse.json(
        { cleared: deleted.length, refundedPoints },
        { status: 200 },
      );
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  } catch (err: any) {
    console.error("[DELETE /api/cart/:id/clear]", err);
    if (err instanceof z.ZodError)
      return NextResponse.json({ error: err.errors }, { status: 400 });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
