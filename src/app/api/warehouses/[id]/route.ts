// src/app/api/warehouses/[id]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { pgPool as pool } from "@/lib/db";
import { getContext } from "@/lib/context";

export async function PUT(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { tenantId, organizationId } = ctx;

  try {
    const warehouseId = params.id;
    const { name, countries, stock } = await req.json();

    if (!name || !Array.isArray(countries) || countries.length === 0) {
      return NextResponse.json(
        { error: "Name and countries (non-empty array) are required" },
        { status: 400 },
      );
    }

    const countriesJson = JSON.stringify(countries);

    // Update only within same tenant/org
    const { rows } = await pool.query(
      `
      UPDATE warehouse
      SET
        name = $1,
        countries = $2::jsonb,
        "updatedAt" = NOW()
      WHERE id = $3
        AND "tenantId" = $4
        AND "organizationId" = $5
      RETURNING *
      `,
      [name, countriesJson, warehouseId, tenantId, organizationId],
    );

    if (rows.length === 0) {
      return NextResponse.json(
        { error: `Warehouse ${warehouseId} not found` },
        { status: 404 },
      );
    }

    const warehouse = rows[0];

    // Replace stock if provided
    if (stock) {
      if (!Array.isArray(stock)) {
        return NextResponse.json({ error: "Stock must be an array" }, { status: 400 });
      }
      await pool.query(
        `DELETE FROM "warehouseStock" WHERE "warehouseId" = $1 AND "tenantId" = $2 AND "organizationId" = $3`,
        [warehouseId, tenantId, organizationId],
      );

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
            warehouseId,
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

    return NextResponse.json({ warehouse }, { status: 200 });
  } catch (error) {
    console.error("[PUT /api/warehouses/[id]] error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { tenantId, organizationId } = ctx;

  try {
    const warehouseId = params.id;
    const { rowCount } = await pool.query(
      `DELETE FROM warehouse WHERE id = $1 AND "tenantId" = $2 AND "organizationId" = $3`,
      [warehouseId, tenantId, organizationId],
    );

    if (rowCount === 0) {
      return NextResponse.json(
        { error: `Warehouse ${warehouseId} not found or unauthorized` },
        { status: 404 },
      );
    }
    return NextResponse.json({ message: "Warehouse deleted" }, { status: 200 });
  } catch (error) {
    console.error("[DELETE /api/warehouses/[id]] error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
