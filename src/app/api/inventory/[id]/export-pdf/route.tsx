// app/api/inventory/[id]/export-pdf/route.tsx
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { getContext } from "@/lib/context";
import { pgPool as pool } from "@/lib/db";
import {
  pdf,
  Document,
  Page,
  Text,
  View,
  StyleSheet,
} from "@react-pdf/renderer";

// PDF styles (kept close to your original)
const styles = StyleSheet.create({
  page: { padding: 24 },
  h1: { fontSize: 18, marginBottom: 8 },
  h2: { fontSize: 14, marginTop: 16, marginBottom: 8 },
  meta: { fontSize: 10, color: "#555", marginBottom: 12 },
  table: {
    display: "table",
    width: "auto",
    borderStyle: "solid",
    borderWidth: 1,
    borderRightWidth: 0,
    borderBottomWidth: 0,
  },
  row: { flexDirection: "row" },
  cell: {
    borderStyle: "solid",
    borderWidth: 1,
    borderLeftWidth: 0,
    borderTopWidth: 0,
    padding: 6,
    fontSize: 10,
    flexWrap: "wrap",
  },
  cellText: {
    fontSize: 10,
    lineHeight: 1.3,
    // @react-pdf doesn't support all web CSS props; harmless if ignored
    wordBreak: "break-word" as any,
  },
  th: { fontSize: 10, fontWeight: 700, backgroundColor: "#f2f2f2" },
  small: { fontSize: 9, color: "#666" },
});

// Small helper table component
function Table({
  columns,
  data,
}: {
  columns: { key: string; header: string; width?: number }[];
  data: Record<string, any>[];
}) {
  return (
    <View style={styles.table}>
      <View style={styles.row}>
        {columns.map((c, i) => (
          <View key={i} style={[styles.cell, styles.th, { width: c.width ?? 120 }]}>
            <Text style={styles.cellText}>{c.header}</Text>
          </View>
        ))}
      </View>
      {data.map((row, rIdx) => (
        <View key={rIdx} style={styles.row}>
          {columns.map((c, i) => (
            <View key={i} style={[styles.cell, { width: c.width ?? 120 }]}>
              <Text style={styles.cellText}>
                {row[c.key] !== null && row[c.key] !== undefined ? String(row[c.key]) : ""}
              </Text>
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> } // ← Next 16 async params
) {
  const { id } = await context.params;

  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { organizationId } = ctx;

  try {
    // 1) Owner / header data (parameterized)
    const ownerSql = `
      SELECT 
        i.id,
        i.reference,
        i."countType",
        i.countries,
        i."createdAt",
        w.name          AS "warehouseName",
        u.name          AS username,
        u.email         AS email
      FROM "inventoryCount" i
      JOIN warehouse w ON i."warehouseId" = w.id
      JOIN "user" u     ON i."userId"     = u.id
      WHERE i.id = $1 AND i."organizationId" = $2
    `;
    const ownerRes = await pool.query(ownerSql, [id, organizationId]);
    const ownerData = ownerRes.rows;

    const ownerRows = ownerData.map((o) => ({
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
    const countProduct = itemsRes.rows;

    // Rehydrate SKU from variation if present (parameterized)
    for (const product of countProduct) {
      if (product.variationId) {
        const varRes = await pool.query(
          `SELECT sku FROM "productVariations" WHERE id = $1`,
          [product.variationId]
        );
        const v = varRes.rows[0];
        if (v?.sku) product.sku = v.sku;
      }
    }

    const rows = countProduct.map((c) => ({
      title: c.title,
      sku: c.sku,
      country: c.country,
      expectedQuantity: c.expectedQuantity,
      countedQuantity:
        c.countedQuantity === null || c.countedQuantity === undefined ? "" : c.countedQuantity,
      discrepancyReason: c.discrepancyReason ?? "",
      isCounted: c.isCounted ? "Yes" : "No",
    }));

    // 3) Build PDF (landscape)
    const first = ownerRows[0];
    const doc = (
      <Document
        author={first ? `${first.name} <${first.email}>` : undefined}
        title={first ? `Inventory ${first.reference}` : "Inventory"}
      >
        {/* Page 1: Information */}
        <Page size="A4" orientation="landscape" style={styles.page}>
          <Text style={styles.h1}>Inventory Information</Text>
          {first ? (
            <Text style={styles.meta}>
              Reference: {first.reference} • Count type: {first.countType} • Date:{" "}
              {first.date ? new Date(first.date).toLocaleString() : "—"}
            </Text>
          ) : (
            <Text style={styles.small}>No header data found</Text>
          )}

          <Text style={styles.h2}>Owner</Text>
          <Table
            columns={[
              { key: "name", header: "Name", width: 180 },
              { key: "email", header: "Email", width: 240 },
              { key: "reference", header: "Reference", width: 140 },
              { key: "countType", header: "Count Type", width: 120 },
              { key: "date", header: "Created At", width: 180 },
            ]}
            data={ownerRows.map((o) => ({
              ...o,
              date: o.date ? new Date(o.date).toLocaleString() : "",
            }))}
          />
        </Page>

        {/* Page 2: Items */}
        <Page size="A4" orientation="landscape" style={styles.page}>
          <Text style={styles.h1}>Inventory Items</Text>
          <Table
            columns={[
              { key: "title", header: "Title", width: 200 },
              { key: "sku", header: "SKU", width: 120 },
              { key: "country", header: "Country", width: 80 },
              { key: "expectedQuantity", header: "Expected", width: 90 },
              { key: "countedQuantity", header: "Counted", width: 90 },
              { key: "discrepancyReason", header: "Discrepancy", width: 260 },
              { key: "isCounted", header: "Counted?", width: 90 },
            ]}
            data={rows}
          />
          <View style={{ marginTop: 12 }}>
            <Text style={styles.small}>Total items: {rows.length}</Text>
          </View>
        </Page>
      </Document>
    );

    const pdfFile = await pdf(doc).toBuffer();

    return new Response(pdfFile, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="inventory-${first?.reference ?? id}.pdf"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err: any) {
    console.error("[GET /api/inventory/[id]/export-pdf] error:", err);
    return NextResponse.json(
      { error: err?.message ?? "Internal error" },
      { status: 500 }
    );
  }
}
