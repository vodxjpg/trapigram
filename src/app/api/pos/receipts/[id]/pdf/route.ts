// src/app/api/pos/receipts/[id]/pdf/route.ts
import { NextRequest, NextResponse } from "next/server";
import { pgPool as pool } from "@/lib/db";
import { getContext } from "@/lib/context";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

export const runtime = "nodejs";

/* -------- helpers -------- */
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

/** Try to read org/store metadata; return [] if tables/columns don’t exist */
async function safeQuery<T = any>(sql: string, params: any[]) {
  try {
    const r = await pool.query<T>(sql, params);
    return r.rows as any[];
  } catch (e: any) {
    if (e?.code === "42P01" || e?.code === "42703") return [];
    throw e;
  }
}

/* -------- PDF helpers (pdf-lib) -------- */
const A4 = { w: 595.28, h: 841.89 };
const MARGIN = 36;

type DrawCtx = {
  page: any;
  x: number;
  y: number;
  w: number;
  h: number;
  helv: any;
  bold: any;
  fontSize: number;
};

function text(page: any, str: string, x: number, y: number, opts: any = {}) {
  page.drawText(str, { x, y, color: rgb(0, 0, 0), size: 10, ...opts });
}
function textRight(page: any, str: string, rightX: number, y: number, font: any, size = 10) {
  const width = font.widthOfTextAtSize(str, size);
  page.drawText(str, { x: rightX - width, y, size, font, color: rgb(0, 0, 0) });
}
function wrapLines(str: string, maxWidth: number, font: any, size = 10): string[] {
  const words = String(str).split(/\s+/);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const test = cur ? cur + " " + w : w;
    if (font.widthOfTextAtSize(test, size) <= maxWidth) {
      cur = test;
    } else {
      if (cur) lines.push(cur);
      // very long single word fallback
      if (font.widthOfTextAtSize(w, size) > maxWidth) {
        lines.push(w);
        cur = "";
      } else {
        cur = w;
      }
    }
  }
  if (cur) lines.push(cur);
  return lines;
}
function newPage(pdf: PDFDocument) {
  return pdf.addPage([A4.w, A4.h]);
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
    /* ── Order ───────────────────────────────────────────────────────────── */
    const { rows: orderRows } = await pool.query(
      `SELECT * FROM orders WHERE id = $1 AND "organizationId" = $2 LIMIT 1`,
      [id, organizationId]
    );
    if (!orderRows.length) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }
    const order: any = orderRows[0];

    /* ── Org/tenant meta (robust) ────────────────────────────────────────── */
    let orgName = process.env.NEXT_PUBLIC_APP_NAME || process.env.APP_NAME || "Store";
    let currency = process.env.NEXT_PUBLIC_DEFAULT_CURRENCY || "USD";
    let orgAddr: any = null;

    const orgRows = await safeQuery(
      `SELECT name, metadata FROM organizations WHERE id = $1 LIMIT 1`,
      [organizationId]
    );
    if (orgRows.length) {
      orgName = orgRows[0].name ?? orgName;
      const meta =
        typeof orgRows[0].metadata === "string"
          ? (() => {
              try {
                return JSON.parse(orgRows[0].metadata);
              } catch {
                return {};
              }
            })()
          : orgRows[0].metadata ?? {};
      currency = meta?.currency || currency;
      orgAddr = meta?.address || orgAddr;
    } else {
      const tRows = await safeQuery(
        `SELECT name, settings FROM tenants WHERE id = $1 LIMIT 1`,
        [organizationId]
      );
      if (tRows.length) {
        orgName = tRows[0].name ?? orgName;
        const settings =
          typeof tRows[0].settings === "string"
            ? (() => {
                try {
                  return JSON.parse(tRows[0].settings);
                } catch {
                  return {};
                }
              })()
            : tRows[0].settings ?? {};
        currency = settings?.currency || currency;
        orgAddr = orgAddr || settings?.address || null;
      }
    }

    /* ── Client (no hard dependency on isWalkIn) ─────────────────────────── */
    let client: { firstName?: string | null; lastName?: string | null; email?: string | null; isWalkIn?: boolean } = {
      firstName: null,
      lastName: null,
      email: null,
      isWalkIn: undefined,
    };
    try {
      const { rows } = await pool.query(
        `SELECT "firstName","lastName",email,"isWalkIn" FROM clients WHERE id = $1 LIMIT 1`,
        [order.clientId]
      );
      if (rows[0]) client = rows[0] as any;
    } catch (e: any) {
      if (e?.code !== "42703") throw e;
      const { rows } = await pool.query(
        `SELECT "firstName","lastName",email FROM clients WHERE id = $1 LIMIT 1`,
        [order.clientId]
      );
      if (rows[0]) {
        const row = rows[0] as any;
        const nameStr = [row.firstName, row.lastName].filter(Boolean).join(" ").toLowerCase();
        client = { ...row, isWalkIn: !row.email && nameStr.includes("walk-in") };
      }
    }
    const clientName =
      [client.firstName, client.lastName].filter(Boolean).join(" ").trim() || "Customer";

    /* ── Parse channel → store/register ───────────────────────────────────── */
    let storeIdFromChannel: string | null = null;
    let registerIdFromChannel: string | null = null;
    if (typeof order.channel === "string") {
      const m = /^pos-([^-\s]+)-([^-\s]+)$/i.exec(order.channel);
      if (m) {
        storeIdFromChannel = m[1] !== "na" ? m[1] : null;
        registerIdFromChannel = m[2] !== "na" ? m[2] : null;
      }
    }

    /* ── Register/Store details ───────────────────────────────────────────── */
    let storeName: string | null = null;
    let storeAddress: any = null;
    let registerLabel: string | null = null;

    if (registerIdFromChannel) {
      const regRows = await safeQuery(
        `SELECT r.id, r.label, s.id AS "storeId", s.name AS "storeName", s.address, s.metadata
           FROM registers r
           LEFT JOIN stores s ON s.id = r."storeId"
          WHERE r.id = $1 AND r."organizationId" = $2
          LIMIT 1`,
        [registerIdFromChannel, organizationId]
      );
      if (regRows.length) {
        registerLabel = regRows[0].label ?? null;
        storeName = regRows[0].storeName ?? null;
        storeAddress = regRows[0].address ?? null;
        const m = regRows[0].metadata;
        if (m) {
          try {
            const parsed = typeof m === "string" ? JSON.parse(m) : m;
            currency = parsed?.currency || currency;
          } catch {}
        }
      }
    } else if (storeIdFromChannel) {
      const sRows = await safeQuery(
        `SELECT s.id, s.name AS "storeName", s.address, s.metadata
           FROM stores s
          WHERE s.id = $1 AND s."organizationId" = $2
          LIMIT 1`,
        [storeIdFromChannel, organizationId]
      );
      if (sRows.length) {
        storeName = sRows[0].storeName ?? null;
        storeAddress = sRows[0].address ?? null;
        try {
          const m = typeof sRows[0].metadata === "string" ? JSON.parse(sRows[0].metadata) : sRows[0].metadata;
          currency = m?.currency || currency;
        } catch {}
      }
    }
    if (!storeAddress) storeAddress = orgAddr;

    /* ── Lines (snapshot) ─────────────────────────────────────────────────── */
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

    /* ── Tax rules per product (additive) ─────────────────────────────────── */
    const productIds = Array.from(new Set(linesDB.map((l) => l.productId)));
    const taxRows = await safeQuery(
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
    for (const r of taxRows as any[]) {
      const cur = rateByProduct[r.productId] ?? 0;
      rateByProduct[r.productId] = cur + Number(r.rate ?? 0);
    }

    /* ── Recompute tax math ───────────────────────────────────────────────── */
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

      return { ...l, netUnit, taxUnit, taxRate: rate, lineNet, lineTax, lineTotal };
    });

    /* ── Payments ─────────────────────────────────────────────────────────── */
    const { rows: payRows } = await pool.query(
      `SELECT op."methodId", op.amount, pm.name
         FROM "orderPayments" op
         LEFT JOIN "paymentMethods" pm ON pm.id = op."methodId"
        WHERE op."orderId" = $1
        ORDER BY op."createdAt" ASC NULLS LAST`,
      [order.id]
    );
    const payments = (payRows || []).map((p: any) => ({
      label: p.name || p.methodId || "Payment",
      amount: Number(p.amount || 0),
    }));
    const paid = payments.reduce((s, p) => s + p.amount, 0);
    const grandTotal = Number(order.totalAmount ?? subtotalNet + taxTotal);
    const change = Math.max(0, paid - grandTotal);

    /* ── Build PDF with pdf-lib (no filesystem fonts) ─────────────────────── */
    const pdf = await PDFDocument.create();
    const page = newPage(pdf);

    const helv = await pdf.embedFont(StandardFonts.Helvetica);
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

    let y = A4.h - MARGIN;

    // Header
    page.drawText(orgName, { x: MARGIN, y, size: 16, font: bold });
    y -= 18;
    page.drawText("POS Receipt", { x: MARGIN, y, size: 10, font: helv, color: rgb(0.2, 0.2, 0.2) });
    y -= 14;

    // Store & Register block
    if (storeName || storeAddress) {
      if (storeName) {
        page.drawText(storeName, { x: MARGIN, y, size: 11, font: bold });
        y -= 14;
      }
      for (const line of addressToLines(storeAddress)) {
        page.drawText(line, { x: MARGIN, y, size: 10, font: helv });
        y -= 12;
      }
      if (registerLabel) {
        page.drawText(`Register: ${registerLabel}`, { x: MARGIN, y, size: 10, font: helv });
        y -= 12;
      }
    }

    // Order meta
    y -= 6;
    const createdAt = new Date(order.createdAt ?? Date.now());
    page.drawText(`Order ID: ${id}`, { x: MARGIN, y, size: 10, font: helv }); y -= 12;
    page.drawText(`Date: ${createdAt.toLocaleString()}`, { x: MARGIN, y, size: 10, font: helv }); y -= 12;
    page.drawText(`Tax Mode: ${taxInclusive ? "Tax Inclusive" : "Tax Exclusive"}`, { x: MARGIN, y, size: 10, font: helv }); y -= 12;
    page.drawText(`Customer: ${clientName}`, { x: MARGIN, y, size: 10, font: helv }); y -= 12;
    if (client.email) { page.drawText(`Email: ${client.email}`, { x: MARGIN, y, size: 10, font: helv }); y -= 12; }

    // Table header
    y -= 8;
    const colX = MARGIN;
    const widths = [40, 260, 90, 80, 90]; // Qty | Item | Unit | Tax | Total
    const totalTableWidth = widths.reduce((a, b) => a + b, 0) + 32;
    page.drawLine({
      start: { x: colX, y: y + 12 },
      end: { x: colX + totalTableWidth, y: y + 12 },
      thickness: 0.5,
      color: rgb(0.7, 0.7, 0.7),
    });

    page.drawText("Qty", { x: colX, y, size: 10, font: bold });
    page.drawText("Item", { x: colX + widths[0] + 8, y, size: 10, font: bold });
    textRight(page, taxInclusive ? "Unit (incl. tax)" : "Unit", colX + widths[0] + widths[1] + 16 + widths[2] - 4, y, bold);
    textRight(page, "Tax", colX + widths[0] + widths[1] + widths[2] + 24 + widths[3] - 4, y, bold);
    textRight(page, "Line Total", colX + widths[0] + widths[1] + widths[2] + widths[3] + 32 + widths[4] - 4, y, bold);
    y -= 16;

    // Rows (+ simple page break)
    const rowGap = 14;
    const minY = MARGIN + 160;

    for (const l of computedLines) {
      if (y < minY) {
        const p2 = newPage(pdf);
        (p2 as any).drawText = page.drawText.bind(p2);
        (p2 as any).drawLine = page.drawLine.bind(p2);
        (p2 as any).drawRectangle = page.drawRectangle?.bind(p2);
        (p2 as any).drawText && (y = A4.h - MARGIN);
      }

      const itemName = l.sku ? `${l.title} (${l.sku})` : l.title;
      const unitDisp = fmtCurrency(Number(l.unitPrice), currency);
      const taxDisp = l.taxRate > 0 ? fmtCurrency(l.taxUnit, currency) : "-";
      const lineTotalDisp = fmtCurrency(l.lineTotal, currency);

      // Qty (right aligned)
      textRight(page, String(l.quantity), colX + widths[0], y, helv);

      // Item (wrap)
      const itemX = colX + widths[0] + 8;
      const itemW = widths[1] - 8;
      const lines = wrapLines(itemName, itemW, helv, 10);
      for (let i = 0; i < lines.length; i++) {
        page.drawText(lines[i], { x: itemX, y: y - i * rowGap, size: 10, font: helv });
      }

      // Unit (right), Tax (right), Total (right)
      textRight(page, unitDisp, colX + widths[0] + widths[1] + 16 + widths[2], y, helv);
      textRight(page, taxDisp, colX + widths[0] + widths[1] + widths[2] + 24 + widths[3], y, helv);
      textRight(page, lineTotalDisp, colX + widths[0] + widths[1] + widths[2] + widths[3] + 32 + widths[4], y, helv);

      y -= rowGap * Math.max(1, lines.length);
    }

    // Totals block
    y -= 8;
    if (y < minY) {
      const p2 = newPage(pdf);
      (p2 as any).drawText = page.drawText.bind(p2);
      y = A4.h - MARGIN;
    }

    const rightColX = colX + totalTableWidth - 220;
    page.drawText("Subtotal (net):", { x: rightColX, y, size: 10, font: helv });
    textRight(page, fmtCurrency(subtotalNet, currency), rightColX + 220, y, helv);
    y -= 14;

    page.drawText("Tax:", { x: rightColX, y, size: 10, font: helv });
    textRight(page, fmtCurrency(taxTotal, currency), rightColX + 220, y, helv);
    y -= 14;

    page.drawText("Grand Total:", { x: rightColX, y, size: 10, font: bold });
    textRight(page, fmtCurrency(grandTotal, currency), rightColX + 220, y, bold);
    y -= 18;

    // Payments
    page.drawText("Payments", { x: colX, y, size: 10, font: bold });
    y -= 12;
    if (payments.length) {
      for (const p of payments) {
        if (y < MARGIN + 60) {
          const p2 = newPage(pdf);
          (p2 as any).drawText = page.drawText.bind(p2);
          y = A4.h - MARGIN;
        }
        page.drawText(p.label, { x: colX, y, size: 10, font: helv });
        textRight(page, fmtCurrency(p.amount, currency), rightColX + 220, y, helv);
        y -= 12;
      }
    } else {
      page.drawText("—", { x: colX, y, size: 10, font: helv });
      y -= 12;
    }

    // Change
    if (change > 0) {
      y -= 4;
      page.drawText("Change Due:", { x: rightColX, y, size: 10, font: bold });
      textRight(page, fmtCurrency(change, currency), rightColX + 220, y, bold);
      y -= 12;
    }

    // Note
    if (order.note) {
      y -= 6;
      page.drawText("Note", { x: colX, y, size: 10, font: bold });
      y -= 12;
      const noteLines = wrapLines(String(order.note), totalTableWidth, helv, 10);
      for (const line of noteLines) {
        page.drawText(line, { x: colX, y, size: 10, font: helv });
        y -= 12;
      }
    }

    // Footer
    y = Math.max(y - 8, MARGIN + 24);
    page.drawLine({
      start: { x: colX, y },
      end: { x: colX + totalTableWidth, y },
      thickness: 0.5,
      color: rgb(0.8, 0.8, 0.8),
    });
    y -= 10;
    page.drawText("Thank you for your purchase.", { x: colX, y, size: 9, font: helv, color: rgb(0.3, 0.3, 0.3) });
    y -= 12;
    page.drawText(orgName, { x: colX, y, size: 9, font: helv, color: rgb(0.3, 0.3, 0.3) });

    const pdfBytes = await pdf.save(); // Uint8Array
    return new NextResponse(Buffer.from(pdfBytes), {
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
