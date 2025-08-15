// src/app/api/warehouses/route.ts
import { NextRequest, NextResponse } from "next/server";
import { pgPool as pool } from "@/lib/db";
import { getContext } from "@/lib/context";

export async function GET(req: NextRequest) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { tenantId, organizationId } = ctx;

  try {
    const { rows: warehouseRows } = await pool.query(
      `
      SELECT w.*,
             ws.id           AS stock_id,
             ws."productId",
             ws."variationId",
             ws."country",
             ws."quantity"
      FROM warehouse w
      LEFT JOIN "warehouseStock" ws ON w.id = ws."warehouseId"
      WHERE w."tenantId" = $1
        AND w."organizationId" = $2
      ORDER BY w."createdAt" DESC
      `,
      [tenantId, organizationId],
    );

    const warehousesMap = new Map<string, any>();

    for (const row of warehouseRows) {
      const warehouseId = row.id;

      if (!warehousesMap.has(warehouseId)) {
        let countries: string[] = [];
        try {
          countries = JSON.parse(row.countries);
        } catch {
          countries = String(row.countries ?? "").split(",").filter(Boolean);
        }

        // Keep API shape backward compatible: organizationId as array
        const orgArray =
          Array.isArray(row.organizationId)
            ? row.organizationId
            : [String(row.organizationId)].filter(Boolean);

        warehousesMap.set(warehouseId, {
          id: row.id,
          tenantId: row.tenantId,
          organizationId: orgArray,
          name: row.name,
          countries,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
          stock: [] as Array<{
            id: string;
            productId: string;
            variationId: string | null;
            country: string;
            quantity: number;
          }>,
        });
      }

      if (row.stock_id) {
        warehousesMap.get(warehouseId).stock.push({
          id: row.stock_id,
          productId: row.productId,
          variationId: row.variationId,
          country: row.country,
          quantity: row.quantity,
        });
      }
    }

    const warehouses = Array.from(warehousesMap.values());
    return NextResponse.json({ warehouses }, { status: 200 });
  } catch (error) {
    console.error("[GET /api/warehouses] error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { tenantId, organizationId } = ctx;

  try {
    // Frontend may still send `organizationId` array; ignore for tenancy safety.
    const { name, countries, stock } = await req.json();

    if (!name || !Array.isArray(countries) || countries.length === 0) {
      return NextResponse.json(
        { error: "Name and countries (array) are required" },
        { status: 400 },
      );
    }

    const countriesJson = JSON.stringify(countries);

    // Create a single warehouse scoped to caller's org/tenant
    const { rows } = await pool.query(
      `
      INSERT INTO warehouse (
        id, "tenantId", "organizationId", name, countries, "createdAt", "updatedAt"
      ) VALUES (
        gen_random_uuid()::text, $1, $2, $3, $4::jsonb, NOW(), NOW()
      )
      RETURNING *
      `,
      [tenantId, organizationId, name, countriesJson],
    );

    const warehouse = rows[0];

    if (Array.isArray(stock) && stock.length > 0) {
      for (const entry of stock) {
        await pool.query(
          `
          INSERT INTO "warehouseStock" (
            id, "warehouseId", "productId", "variationId",
            country, quantity, "organizationId", "tenantId", "createdAt", "updatedAt"
          )
          VALUES (
            gen_random_uuid()::text, $1, $2, $3, $4, $5, $6, $7, NOW(), NOW()
          )
          `,
          [
            warehouse.id,
            entry.productId,
            entry.variationId || null,
            entry.country,
            entry.quantity,
            organizationId,
            tenantId,
          ],
        );
      }
    }

    return NextResponse.json({ warehouses: [warehouse] }, { status: 201 });
  } catch (error) {
    console.error("[POST /api/warehouses] error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
