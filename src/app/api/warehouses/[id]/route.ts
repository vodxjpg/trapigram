// src/app/api/warehouses/[id]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { pgPool as pool } from "@/lib/db";
import { getContext } from "@/lib/context";
import { z } from "zod";

export const runtime = "nodejs";

const BodySchema = z.object({
  name: z.string().min(1),
  countries: z.array(z.string().min(1)).min(1),
  stock: z
    .array(
      z.object({
        productId: z.string().min(1),
        variationId: z.string().min(1).nullable().optional(),
        country: z.string().min(1),
        quantity: z.coerce.number().int().nonnegative(),
      })
    )
    .optional(),
});

export async function PUT(
  req: NextRequest,
  context: { params: Promise<{ id: string }> } // Next 16: params is async
) {
  const { id: warehouseId } = await context.params;

  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { tenantId, organizationId } = ctx;

  try {
    const parsed = BodySchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }

    const { name, countries, stock } = parsed.data;

    const { rows } = await pool.query(
      `
      UPDATE warehouse
         SET name = $1,
             countries = $2::jsonb,
             "updatedAt" = NOW()
       WHERE id = $3
         AND "tenantId" = $4
         AND "organizationId" = $5
       RETURNING *
      `,
      [name, JSON.stringify(countries), warehouseId, tenantId, organizationId]
    );

    if (!rows.length) {
      return NextResponse.json(
        { error: `Warehouse ${warehouseId} not found` },
        { status: 404 }
      );
    }

    const warehouse = rows[0];

    // Replace stock if provided
    if (stock) {
      await pool.query(
        `DELETE FROM "warehouseStock"
          WHERE "warehouseId" = $1 AND "tenantId" = $2 AND "organizationId" = $3`,
        [warehouseId, tenantId, organizationId]
      );

      // Insert new stock rows
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
            entry.variationId ?? null,
            entry.country,
            entry.quantity,
            organizationId,
            tenantId,
          ]
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
  context: { params: Promise<{ id: string }> } // Next 16: params is async
) {
  const { id: warehouseId } = await context.params;

  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { tenantId, organizationId } = ctx;

  try {
    const { rowCount } = await pool.query(
      `DELETE FROM warehouse
        WHERE id = $1 AND "tenantId" = $2 AND "organizationId" = $3`,
      [warehouseId, tenantId, organizationId]
    );

    if (rowCount === 0) {
      return NextResponse.json(
        { error: `Warehouse ${warehouseId} not found or unauthorized` },
        { status: 404 }
      );
    }

    return NextResponse.json({ message: "Warehouse deleted" }, { status: 200 });
  } catch (error) {
    console.error("[DELETE /api/warehouses/[id]] error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
