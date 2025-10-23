// src/app/api/suppliersOrder/[id]/complete/route.ts
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { pgPool as pool } from "@/lib/db";
import { getContext } from "@/lib/context";
import { v4 as uuidv4 } from "uuid";

type RouteParamsAsync = { params: Promise<{ id: string }> };

type Row = {
  productId: string;
  variationId: string | null;
  country: string;
  quantity: string | number;
  cost: string | number;
};

type Grouped = {
  productId: string;
  variationId: string | null;
  quantity: number;
  cost: Record<string, number>; // country → cost
};

export function groupByProduct(rows: Row[]): Grouped[] {
  const map = new Map<string, Grouped>();

  for (const r of rows) {
    const pid = r.productId;
    const vid = r.variationId ?? null;
    const key = `${pid}:${vid ?? "base"}`;

    const q = Number(r.quantity ?? 0) || 0;
    const c = Number(r.cost ?? 0) || 0;
    const ct = r.country;

    if (!map.has(key)) {
      map.set(key, { productId: pid, variationId: vid, quantity: 0, cost: {} });
    }
    const entry = map.get(key)!;

    entry.quantity += q;
    entry.cost[ct] = Math.max(entry.cost[ct] ?? -Infinity, c);
  }

  return Array.from(map.values());
}

type CostMap = Record<string, number>;

/** Replace values from `first` only where keys already exist in `second`. */
function overrideMatches(second: CostMap, first: CostMap): CostMap {
  const out = { ...second };
  for (const [k, v] of Object.entries(first)) {
    // @ts-ignore Node 18+/TS lib has Object.hasOwn
    if (Object.hasOwn(out, k)) out[k] = v;
  }
  return out;
}

export async function PATCH(req: NextRequest, { params }: RouteParamsAsync) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;

  const { organizationId, tenantId } = ctx;
  const { id } = await params;

  if (!id) {
    return NextResponse.json({ error: "Missing order id" }, { status: 400 });
  }

  try {
    const body = await req.json().catch(() => ({} as any));

    // Get supplier cart id for this supplier order
    const supplierCartQuery = `SELECT "supplierCartId" FROM "supplierOrders" WHERE id = $1 LIMIT 1`;
    const supplierCartResult = await pool.query(supplierCartQuery, [id]);
    const supplierCartId: string | undefined = supplierCartResult.rows[0]?.supplierCartId;
    if (!supplierCartId) {
      return NextResponse.json({ error: "Supplier cart not found" }, { status: 404 });
    }

    // Read all supplier cart products
    const productsQuery = `
      SELECT "productId","variationId",country,quantity,cost
        FROM "supplierCartProducts"
       WHERE "supplierCartId" = $1
    `;
    const productsResult = await pool.query(productsQuery, [supplierCartId]);
    const products: Row[] = productsResult.rows;

    // Aggregate new costs per (product, variation)
    const newCosts = groupByProduct(products);

    // Update costs (variation or product)
    for (const cos of newCosts) {
      if (cos.variationId) {
        // Variation-level cost
        const curVarRes = await pool.query(
          `SELECT cost FROM "productVariations" WHERE id = $1`,
          [cos.variationId]
        );
        const currentVarCost: CostMap = curVarRes.rowCount ? curVarRes.rows[0].cost : {};
        const mergedVarCost = overrideMatches(currentVarCost ?? {}, cos.cost);

        await pool.query(
          `UPDATE "productVariations" SET cost = $1, "updatedAt" = NOW() WHERE id = $2`,
          [mergedVarCost, cos.variationId]
        );

        // Optionally reflect into parent product
        const parentRes = await pool.query(`SELECT cost FROM products WHERE id = $1`, [cos.productId]);
        const parentCost: CostMap = parentRes.rowCount ? parentRes.rows[0].cost : {};
        const mergedParent = overrideMatches(parentCost ?? {}, cos.cost);
        await pool.query(`UPDATE products SET cost = $1, "updatedAt" = NOW() WHERE id = $2`, [
          mergedParent,
          cos.productId,
        ]);
      } else {
        // Product-level cost (no variant)
        const costRes = await pool.query(`SELECT cost FROM products WHERE id = $1`, [cos.productId]);
        const currentCost: CostMap = costRes.rowCount ? costRes.rows[0].cost : {};
        const merged = overrideMatches(currentCost ?? {}, cos.cost);
        await pool.query(`UPDATE products SET cost = $1, "updatedAt" = NOW() WHERE id = $2`, [
          merged,
          cos.productId,
        ]);
      }
    }

    // Apply received stock updates safely (parameterized and NULL-safe on variationId)
    const updates: any[] = [];

    if (Array.isArray(body.received)) {
      for (const rec of body.received) {
        const variationId: string | null = rec.variationId ?? null;

        // Get current stock (NULL-safe variationId)
        const getStockQuery = `
          SELECT quantity
            FROM "warehouseStock"
           WHERE "warehouseId" = $1
             AND "productId"  = $2
             AND country      = $3
             AND (("variationId" IS NULL AND $4 IS NULL) OR "variationId" = $4)
           LIMIT 1
        `;
        const getStockResult = await pool.query(getStockQuery, [
          rec.warehouseId,
          rec.productId,
          rec.country,
          variationId,
        ]);
        const existing = getStockResult.rows[0];

        if (!existing) {
          // Insert new stock row
          const wareStockId = uuidv4();
          const insertStockQuery = `
            INSERT INTO "warehouseStock"
              (id,"warehouseId","productId","variationId",country,quantity,"organizationId","tenantId","createdAt","updatedAt")
            VALUES
              ($1,$2,$3,$4,$5,$6,$7,$8,NOW(),NOW())
            RETURNING *
          `;
          const insertStockResult = await pool.query(insertStockQuery, [
            wareStockId,
            rec.warehouseId,
            rec.productId,
            variationId,
            rec.country,
            rec.received,
            organizationId,
            tenantId,
          ]);
          updates.push(insertStockResult.rows[0]);
        } else {
          // Update existing stock
          const updateStockQuery = `
            UPDATE "warehouseStock"
               SET quantity = $1, "updatedAt" = NOW()
             WHERE "warehouseId" = $2
               AND "productId"   = $3
               AND country       = $4
               AND (("variationId" IS NULL AND $5 IS NULL) OR "variationId" = $5)
             RETURNING *
          `;
          const updatedStockResult = await pool.query(updateStockQuery, [
            Number(rec.received) + Number(existing.quantity),
            rec.warehouseId,
            rec.productId,
            rec.country,
            variationId,
          ]);
          updates.push(updatedStockResult.rows[0]);
        }

        // Mark supplier cart product as received
        const receivedQuery = `
          UPDATE "supplierCartProducts"
             SET received = $1, "updatedAt" = NOW()
           WHERE "supplierCartId" = $2
             AND "productId"      = $3
             AND country          = $4
             AND (("variationId" IS NULL AND $5 IS NULL) OR "variationId" = $5)
           RETURNING *
        `;
        await pool.query(receivedQuery, [
          rec.received,
          supplierCartId,
          rec.productId,
          rec.country,
          variationId,
        ]);
      }
    }

    // Complete the supplier order
    const completeOrderQuery = `
      UPDATE "supplierOrders"
         SET status = 'completed', "updatedAt" = NOW()
       WHERE id = $1
       RETURNING *
    `;
    const completeOrderResult = await pool.query(completeOrderQuery, [id]);
    const completeOrder = completeOrderResult.rows[0];

    return NextResponse.json({ completeOrder }, { status: 200 });
  } catch (error) {
    console.error("PATCH /api/suppliersOrder/[id]/complete error:", error);
    return NextResponse.json({ error: "Internal server error." }, { status: 500 });
  }
}
