// src/app/api/pos/receipts/[id]/pdf/route.ts
import { NextRequest, NextResponse } from "next/server";
import { pgPool as pool } from "@/lib/db";
import { getContext } from "@/lib/context";
import PDFDocument from "pdfkit";

export const runtime = "nodejs";

type LineDB = {
  productId: string;
  variationId: string | null;
  quantity: number;
  unitPrice: number;
  title: string;
  sku: string | null;
};

function fmtCurrency(amount: number, currency = "USD", locale = "en-US") {
  return new Intl.NumberFormat(locale, { style: "currency", currency }).format(
    Number.isFinite(amount) ? amount : 0
  );
}

function addressToLines(addr: any): string[] {
  if (!addr || typeof addr !== "object") return [];
  const line1 = [addr.street, addr.street2].filter(Boolean).join(", ");
  const line2 = [addr.city, addr.state, addr.postal].filter(Boolean).join(", ");
  const line3 = [addr.country].filter(Boolean).join(", ");
  return [line1, line2, line3].filter((s) => s && s.trim().length);
}

function drawRow(
  doc: PDFKit.PDFDocument,
  x: number,
  y: number,
  widths: number[],
  cells: (string | number)[],
  options: { bold?: boolean } = {}
) {
  const [wQty, wTitle, wUnit, wTax, wTotal] = widths;
  const font = options.bold ? "Helvetica-Bold" : "Helvetica";

  doc.font(font).fontSize(10);

  doc.text(String(cells[0] ?? ""), x, y, { width: wQty, align: "right" });
  doc.text(String(cells[1] ?? ""), x + wQty + 8, y, { width: wTitle - 8, align: "left" });
  doc.text(String(cells[2] ?? ""), x + wQty + wTitle + 16, y, { width: wUnit - 16, align: "right" });
  doc.text(String(cells[3] ?? ""), x + wQty + wTitle + wUnit + 24, y, { width: wTax - 24, align: "right" });
  doc.text(String(cells[4] ?? ""), x + wQty + wTitle + wUnit + wTax + 32, y, { width: wTotal - 32, align: "right" });
}

function collectStream(doc: PDFKit.PDFDocument): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on("data", (b) => chunks.push(Buffer.isBuffer(b) ? b : Buffer.from(b)));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { organizationId } = ctx;
  const { id } = await params;

  try {
    /* ── Load order (payments, totals, etc.) ───────────────────────────────── */
    const { rows: orderRows } = await pool.query(
      `SELECT *
         FROM orders
        WHERE id = $1 AND "organizationId" = $2`,
      [id, organizationId]
    );
    if (!orderRows.length) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }
    const order = orderRows[0];

    /* ── Organization (name, currency, fallback address) ───────────────────── */
    const { rows: orgRows } = await pool.query(
      `SELECT name, metadata FROM organizations WHERE id = $1`,
      [organizationId]
    );
    const org = orgRows[0] ?? { name: "Organization", metadata: {} };
    const orgMeta = (org.metadata ?? {}) as any;
    const currency = orgMeta.currency ?? "USD";
    const orgAddr = orgMeta.address ?? null;

    /* ── Client (suppress email for walk-in) ───────────────────────────────── */
    const { rows: clientRows } = await pool.query(
      `SELECT id, name, email, "isWalkIn" FROM clients WHERE id = $1`,
      [order.clientId]
    );
    const client = clientRows[0] ?? { name: "Customer", email: null, isWalkIn: true };

    /* ── Register + Store (address printed; fallback to org address) ───────── */
    let storeName: string | null = null;
    let storeAddress: any = null;
    let registerLabel: string | null = null;

    if (order.registerId) {
      const { rows: regRows } = await pool.query(
        `SELECT r.id, r.label, s.id AS "storeId", s.name AS "storeName", s.address
           FROM registers r
           LEFT JOIN stores s ON s.id = r."storeId"
          WHERE r.id = $1 AND r."organizationId" = $2`,
        [order.registerId, organizationId]
      );
      if (regRows.length) {
        registerLabel = regRows[0].label ?? null;
        storeName = regRows[0].storeName ?? null;
        storeAddress = regRows[0].address ?? null;
      }
    }
    if (!storeAddress) storeAddress = orgAddr;

    /* ── Lines: reconstruct from cartProducts (snapshot at checkout) ───────── */
    const { rows: linesDB } = await pool.query<LineDB>(
      `SELECT cp."productId", cp."variationId", cp.quantity, cp."unitPrice",
              p.title, p.sku
         FROM "cartProducts" cp
         JOIN products p ON p.id = cp."productId"
        WHERE cp."cartId" = $1
        ORDER BY cp."createdAt"`,
      [order.cartId]
    );
    if (!linesDB.length) {
      return NextResponse.json({ error: "No lines for order" }, { status: 404 });
    }

    /* ── Tax rules per product (can be multiple -> additive) ───────────────── */
    const productIds = Array.from(new Set(linesDB.map((l) => l.productId)));
    const { rows: taxRows } = await pool.query(
      `SELECT ptr."productId", tr.rate
         FROM "productTaxRules" ptr
         JOIN "taxRules" tr ON tr.id = ptr."taxRuleId"
        WHERE ptr."organizationId" = $1
          AND tr."organizationId" = $1
          AND tr.active = true
          AND ptr."productId" = ANY($2::text[])`,
      [organizationId, productIds]
    );
    const rateByProduct: Record<string, number> = {};
    for (const r of taxRows) {
      const cur = rateByProduct[r.productId] ?? 0;
      rateByProduct[r.productId] = cur + Number(r.rate ?? 0); // rate as fraction (e.g., 0.10)
    }

    /* ── Recompute tax math, mirroring /pos/checkout ───────────────────────── */
    const taxInclusive: boolean = !!order.taxInclusive;
    let subtotalNet = 0;
    let taxTotal = 0;
    const computedLines = linesDB.map((l) => {
      const qty = Number(l.quantity);
      const unit = Number(l.unitPrice);
      const rate = Number(rateByProduct[l.productId] ?? 0);

      let netUnit = unit;
      let taxUnit = 0;
      if (taxInclusive && rate > 0) {
        taxUnit = unit * (rate / (1 + rate));
        netUnit = unit - taxUnit;
      } else if (!taxInclusive && rate > 0) {
        taxUnit = unit * rate;
      }

      const lineNet = netUnit * qty;
      const lineTax = taxUnit * qty;
      const lineTotal = taxInclusive ? unit * qty : (netUnit + taxUnit) * qty;

      subtotalNet += lineNet;
      taxTotal += lineTax;

      return {
        ...l,
        netUnit,
        taxUnit,
        taxRate: rate,
        lineNet,
        lineTax,
        lineTotal,
      };
    });

    const payments = Array.isArray(order.payments) ? order.payments : [];
    const paid = payments.reduce((s: number, p: any) => s + Number(p.amount ?? 0), 0);
    const grandTotal = Number(order.total ?? subtotalNet + taxTotal);
    const change = Math.max(0, paid - grandTotal);

    /* ── Build PDF ─────────────────────────────────────────────────────────── */
    const doc = new PDFDocument({ size: "A4", margin: 36 });
    const pdfBufferP = collectStream(doc);

    // Header
    doc.font("Helvetica-Bold").fontSize(16).text(org.name ?? "Receipt", { align: "left" });
    doc.moveDown(0.25);
    doc.font("Helvetica").fontSize(10).text("POS Receipt", { align: "left" });
    doc.moveDown(0.5);

    // Store & Register block (if present)
    if (storeName || storeAddress) {
      doc.font("Helvetica-Bold").fontSize(11).text(storeName ?? "Store", { continued: false });
      const lines = addressToLines(storeAddress);
      doc.font("Helvetica").fontSize(10);
      for (const line of lines) doc.text(line);
      if (registerLabel) doc.text(`Register: ${registerLabel}`);
    } else {
      doc.font("Helvetica").fontSize(10).text("Register: N/A");
    }

    // Order meta
    doc.moveDown(0.5);
    const createdAt = new Date(order.createdAt ?? Date.now());
    doc.text(`Order ID: ${id}`);
    doc.text(`Date: ${createdAt.toLocaleString()}`);
    doc.text(`Tax Mode: ${taxInclusive ? "Tax Inclusive" : "Tax Exclusive"}`);
    if (client?.name) doc.text(`Customer: ${client.name}`);
    const showEmail = client && client.isWalkIn !== true;
    if (showEmail && client.email) doc.text(`Email: ${client.email}`);

    // Table header
    doc.moveDown(0.75);
    const x = doc.page.margins.left;
    let y = doc.y + 2;
    const widths = [40, 260, 90, 80, 90]; // Qty | Item | Unit | Tax | Total
    doc.rect(x, y - 4, widths.reduce((a, b) => a + b, 0) + 32, 22).strokeOpacity(0.3).stroke();
    drawRow(
      doc,
      x,
      y,
      widths,
      [
        "Qty",
        "Item",
        taxInclusive ? "Unit (incl. tax)" : "Unit",
        "Tax",
        "Line Total",
      ],
      { bold: true }
    );
    y += 18;

    // Rows
    const maxY = doc.page.height - doc.page.margins.bottom - 140;
    const rowGap = 16;

    for (const l of computedLines) {
      const itemName = l.sku ? `${l.title} (${l.sku})` : l.title;
      const unitDisp = fmtCurrency(Number(l.unitPrice), currency);
      const taxDisp = l.taxRate > 0 ? fmtCurrency(l.taxUnit, currency) : "-";
      const lineTotalDisp = fmtCurrency(l.lineTotal, currency);

      if (y > maxY) {
        doc.addPage();
        y = doc.page.margins.top;
      }
      drawRow(doc, x, y, widths, [l.quantity, itemName, unitDisp, taxDisp, lineTotalDisp]);
      y += rowGap;
    }

    // Totals block
    y += 10;
    if (y > maxY) {
      doc.addPage();
      y = doc.page.margins.top;
    }
    const rightColX = x + widths.reduce((a, b) => a + b, 0) + 32 - 220;

    doc.font("Helvetica").fontSize(10);
    doc.text("Subtotal (net):", rightColX, y, { width: 120, align: "right" });
    doc.text(fmtCurrency(subtotalNet, currency), rightColX + 130, y, { width: 90, align: "right" });
    y += 16;

    doc.text("Tax:", rightColX, y, { width: 120, align: "right" });
    doc.text(fmtCurrency(taxTotal, currency), rightColX + 130, y, { width: 90, align: "right" });
    y += 16;

    doc.font("Helvetica-Bold");
    doc.text("Grand Total:", rightColX, y, { width: 120, align: "right" });
    doc.text(fmtCurrency(grandTotal, currency), rightColX + 130, y, { width: 90, align: "right" });
    y += 20;

    // Payments
    doc.font("Helvetica-Bold").text("Payments", x, y);
    y += 14;
    doc.font("Helvetica");
    if (Array.isArray(payments) && payments.length) {
      for (const p of payments) {
        const label = p.methodId ?? "Payment";
        const amt = fmtCurrency(Number(p.amount ?? 0), currency);
        if (y > maxY) {
          doc.addPage();
          y = doc.page.margins.top;
        }
        doc.text(`${label}`, x, y, { width: 200, align: "left" });
        doc.text(amt, rightColX + 130, y, { width: 90, align: "right" });
        y += 14;
      }
    } else {
      doc.text("—", x, y);
      y += 14;
    }

    // Change line (if any)
    if (change > 0) {
      y += 6;
      doc.font("Helvetica-Bold").text("Change Due:", rightColX, y, { width: 120, align: "right" });
      doc.text(fmtCurrency(change, currency), rightColX + 130, y, { width: 90, align: "right" });
      y += 16;
    }

    // Note
    if (order.note) {
      y += 8;
      if (y > maxY) {
        doc.addPage();
        y = doc.page.margins.top;
      }
      doc.font("Helvetica-Bold").text("Note", x, y);
      y += 12;
      doc.font("Helvetica").text(String(order.note), x, y, {
        width: widths.reduce((a, b) => a + b, 0) + 32,
      });
      y = doc.y + 8;
    }

    // Footer
    y = Math.max(y + 12, doc.page.height - doc.page.margins.bottom - 60);
    doc.moveTo(x, y).lineTo(x + widths.reduce((a, b) => a + b, 0) + 32, y).strokeOpacity(0.2).stroke();
    doc.font("Helvetica").fontSize(9).fillOpacity(0.7);
    doc.text("Thank you for your purchase.", x, y + 8);
    doc.text("No branding configured.", x, y + 22);

    doc.end();
    const pdf = await pdfBufferP;

    return new NextResponse(pdf, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="receipt-${id}.pdf"`,
        "Cache-Control": "private, max-age=0, must-revalidate",
      },
    });
  } catch (err: any) {
    console.error("[GET /pos/receipts/:id/pdf]", err);
    return NextResponse.json(
      { error: err?.message ?? "Internal server error" },
      { status: 500 }
    );
  }
}
