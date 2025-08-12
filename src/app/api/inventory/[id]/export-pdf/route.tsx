// app/api/inventory/[id]/export-pdf/route.tsx

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

// IMPORTANT: keep Node runtime (react-pdf uses Node APIs)
export const runtime = "nodejs";

// PDF styles with wrapping enabled for table cells
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
    // enable wrapping inside cells
    flexWrap: "wrap",
  },
  // dedicate this to the <Text> inside each cell for word-breaking
  cellText: {
    fontSize: 10,
    lineHeight: 1.3,
    // break long words / URLs
    wordBreak: "break-word",
  },
  th: { fontSize: 10, fontWeight: 700, backgroundColor: "#f2f2f2" },
  small: { fontSize: 9, color: "#666" },
});

// Small helper to render simple tables with wrapping cells
function Table({
  columns,
  data,
}: {
  columns: { key: string; header: string; width?: number }[];
  data: Record<string, any>[];
}) {
  return (
    <View style={styles.table}>
      {/* Header */}
      <View style={styles.row}>
        {columns.map((c, i) => (
          <View
            key={i}
            style={[styles.cell, styles.th, { width: c.width ?? 120 }]}
          >
            <Text style={styles.cellText}>{c.header}</Text>
          </View>
        ))}
      </View>

      {/* Rows */}
      {data.map((row, rIdx) => (
        <View key={rIdx} style={styles.row}>
          {columns.map((c, i) => (
            <View key={i} style={[styles.cell, { width: c.width ?? 120 }]}>
              <Text style={styles.cellText}>
                {row[c.key] !== null && row[c.key] !== undefined
                  ? String(row[c.key])
                  : ""}
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
  { params }: { params: { id: string } }
) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { organizationId } = ctx;

  try {
    const { id } = params;

    // 1) Owner / header data
    const query = `
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
      JOIN "user" u ON i."userId" = u.id
      WHERE i.id = '${id}' AND i."organizationId" = '${organizationId}'
    `;
    const result = await pool.query(query);
    const ownerData = result.rows;

    const ownerRows = ownerData.map((o) => ({
      name: o.username,
      email: o.email,
      reference: o.reference,
      countType: o.countType,
      date: o.createdAt,
    }));

    // 2) Inventory items
    const countProductQuery = `
      SELECT ic.country,
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
      WHERE ic."inventoryCountId" = '${id}'
    `;
    const countProductResult = await pool.query(countProductQuery);
    const countProduct = countProductResult.rows;

    for (const product of countProduct) {
      if (product.variationId !== null) {
        const variationQuery = `SELECT sku FROM "productVariations" WHERE id = '${product.variationId}'`;
        const variationResult = await pool.query(variationQuery);
        const v = variationResult.rows[0];
        if (v?.sku) product.sku = v.sku;
      }
    }

    const rows = countProduct.map((c) => ({
      //id: c.id,
      title: c.title,
      sku: c.sku,
      country: c.country,
      expectedQuantity: c.expectedQuantity,
      countedQuantity:
        c.countedQuantity === null || c.countedQuantity === undefined
          ? ""
          : c.countedQuantity,
      discrepancyReason: c.discrepancyReason ?? "",
      isCounted: c.isCounted ? "Yes" : "No",
    }));

    // 3) Build PDF (LANDSCAPE pages)
    const first = ownerRows[0];
    const doc = (
      <Document
        author={first ? `${first.name} <${first.email}>` : undefined}
        title={first ? `Inventory ${first.reference}` : "Inventory"}
      >
        {/* Page 1: Information (landscape) */}
        <Page size="A4" orientation="landscape" style={styles.page}>
          <Text style={styles.h1}>Inventory Information</Text>
          {first ? (
            <Text style={styles.meta}>
              Reference: {first.reference} • Count type: {first.countType} •
              Date: {first.date ? new Date(first.date).toLocaleString() : "—"}
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

        {/* Page 2: Items (landscape) */}
        <Page size="A4" orientation="landscape" style={styles.page}>
          <Text style={styles.h1}>Inventory Items</Text>
          <Table
            columns={[
              // removed { key: "id", ... }
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
      },
    });
  } catch (err: any) {
    return new Response(
      JSON.stringify({ error: err.message ?? "Internal error" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
