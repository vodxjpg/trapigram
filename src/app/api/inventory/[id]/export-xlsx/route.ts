// app/api/inventory/[id]/export-xlsx/route.ts
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { getContext } from "@/lib/context";
import { pgPool as pool } from "@/lib/db";
import * as XLSX from "xlsx";

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> } // ← Next 16: params is a Promise
) {
  const { id } = await context.params;

  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { organizationId } = ctx;

  try {
    // 1) Header / owner data (parameterized)
    const ownerSql = `
      SELECT 
        i.id, 
        i.reference, 
        i."countType", 
        i.countries, 
        i."createdAt", 
        w.name, 
        u.name AS username, 
        u.email
      FROM "inventoryCount" i
      JOIN warehouse w ON i."warehouseId" = w.id
      JOIN "user" u     ON i."userId" = u.id
      WHERE i.id = $1 AND i."organizationId" = $2
    `;
    const ownerRes = await pool.query(ownerSql, [id, organizationId]);
    const ownerRows = ownerRes.rows.map((o) => ({
      name: o.username,
      email: o.email,
      reference: o.reference,
      countType: o.countType,
      date: o.createdAt,
    }));

    // 2) Inventory items (parameterized)
    const itemsSql = `
      SELECT 
        ic.country,
        ic."expectedQuantity",
        ic."countedQuantity",
        ic."variationId",
        ic."discrepancyReason",
        ic."isCounted",
        p.title,
        p.sku,
        p.id
      FROM "inventoryCountItems" ic
      JOIN products p ON ic."productId" = p."id"
      WHERE ic."inventoryCountId" = $1
    `;
    const itemsRes = await pool.query(itemsSql, [id]);
    const items = itemsRes.rows;

    // If a row references a variation, prefer the variation SKU (parameterized)
    for (const row of items) {
      if (row.variationId) {
        const varRes = await pool.query(
          `SELECT sku FROM "productVariations" WHERE id = $1`,
          [row.variationId]
        );
        const v = varRes.rows[0];
        if (v?.sku) row.sku = v.sku;
      }
    }

    const inventoryRows = items.map((c) => ({
      id: c.id,
      title: c.title,
      sku: c.sku,
      country: c.country,
      expectedQuantity: c.expectedQuantity,
      countedQuantity:
        c.countedQuantity === null || c.countedQuantity === undefined
          ? ""
          : c.countedQuantity,
      discrepancyReason: c.discrepancyReason ?? "",
      isCounted: !!c.isCounted,
    }));

    // 3) Build XLSX workbook with two sheets
    const wb = XLSX.utils.book_new();

    // Sheet 1: Information
    const infoWs = XLSX.utils.json_to_sheet(
      ownerRows.map((o) => ({
        ...o,
        date: o.date ? new Date(o.date).toLocaleString() : "",
      }))
    );
    XLSX.utils.book_append_sheet(wb, infoWs, "Information");

    // Sheet 2: Inventory
    const invWs = XLSX.utils.json_to_sheet(inventoryRows);
    XLSX.utils.book_append_sheet(wb, invWs, "Inventory");

    const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

    return new Response(buffer, {
      status: 200,
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="inventory-${id}.xlsx"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err: any) {
    console.error("[GET /api/inventory/[id]/export-xlsx] error:", err);
    return NextResponse.json(
      { error: err?.message ?? "Internal error" },
      { status: 500 }
    );
  }
}
