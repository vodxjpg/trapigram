import { NextRequest, NextResponse } from "next/server";
import { pgPool as pool } from "@/lib/db";
import { getContext } from "@/lib/context";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

export const runtime = "nodejs";

/* helpers (unchanged/trimmed) */
const A4 = { w: 595.28, h: 841.89 };
const THERMAL_W = 226.77; // ~80mm
const MARGIN = 18;

function addressToLines(addr: any): string[] {
  if (!addr) return [];
  const line1 = [addr.street, addr.street2].filter(Boolean).join(", ");
  const line2 = [addr.city, addr.state, addr.postal].filter(Boolean).join(", ");
  const line3 = [addr.country].filter(Boolean).join(", ");
  return [line1, line2, line3].filter(Boolean);
}
function fmt(amount: number, currency = "USD", locale = "en-US") {
  return new Intl.NumberFormat(locale, { style: "currency", currency }).format(amount || 0);
}
function asArray(x: any) {
  try { return Array.isArray(x) ? x : JSON.parse(x); } catch { return []; }
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { id } = await params;

  try {
    // ───────────────────────────────────────────────────────── Order
    const { rows: ordRows } = await pool.query(
      `SELECT * FROM orders WHERE id = $1 AND "organizationId" = $2 LIMIT 1`,
      [id, ctx.organizationId]
    );
    if (!ordRows.length) return NextResponse.json({ error: "Order not found" }, { status: 404 });
    const order: any = ordRows[0];

    // Currency + org name (best-effort)
    let orgName = process.env.NEXT_PUBLIC_APP_NAME || "Store";
    let currency = process.env.NEXT_PUBLIC_DEFAULT_CURRENCY || "USD";
    try {
      const org = await pool.query(`SELECT name, metadata FROM organizations WHERE id = $1`, [ctx.organizationId]);
      if (org.rowCount) {
        orgName = org.rows[0].name ?? orgName;
        const meta = typeof org.rows[0].metadata === "string" ? JSON.parse(org.rows[0].metadata) : org.rows[0].metadata ?? {};
        currency = meta?.currency || currency;
      }
    } catch { /* ignore */ }

    // ────────────────────────────────────────────── Parse channel → store/register
    let storeIdFromChannel: string | null = null;
    let registerIdFromChannel: string | null = null;
    if (typeof order.channel === "string") {
      const m = /^pos-([^-\s]+)-([^-\s]+)$/i.exec(order.channel);
      if (m) {
        storeIdFromChannel = m[1] !== "na" ? m[1] : null;
        registerIdFromChannel = m[2] !== "na" ? m[2] : null;
      }
    }

    // ────────────────────────────────────────────── Store + default template
    let storeName: string | null = null;
    let storeAddress: any = null;
    let defaultTemplateId: string | null = null;

    if (storeIdFromChannel) {
      const s = await pool.query(
        `SELECT name, address, "defaultReceiptTemplateId"
           FROM stores
          WHERE id = $1 AND "organizationId" = $2 LIMIT 1`,
        [storeIdFromChannel, ctx.organizationId]
      );
      if (s.rowCount) {
        storeName = s.rows[0].name ?? null;
        storeAddress = s.rows[0].address ?? null;
        defaultTemplateId = s.rows[0].defaultReceiptTemplateId ?? null;
      }
    }

    // Optional override (?templateId=...)
    const sp = new URL(req.url).searchParams;
    const templateOverride = sp.get("templateId");

    // Load template (fallback: minimal defaults)
    let tpl = {
      id: null as string | null,
      printFormat: "thermal" as "thermal" | "a4",
      options: {
        showLogo: true,
        showCompanyName: true,
        headerText: null as string | null,
        showStoreAddress: false,
        labels: { item: "Item", price: "Price", subtotal: "Subtotal", discount: "Discount", tax: "Tax", total: "Total", change: "Change", outstanding: "Outstanding", servedBy: "Served by" },
        flags: { hideDiscountIfZero: true, printBarcode: true, showOrderKey: true, showCashier: true },
      },
    };

    const tplId = templateOverride || defaultTemplateId;
    if (tplId) {
      const t = await pool.query(
        `SELECT id,"printFormat",options
           FROM "posReceiptTemplates"
          WHERE id = $1 AND "organizationId" = $2 LIMIT 1`,
        [tplId, ctx.organizationId]
      );
      if (t.rowCount) {
        tpl = {
          id: t.rows[0].id,
          printFormat: t.rows[0].printFormat,
          options: typeof t.rows[0].options === "string" ? JSON.parse(t.rows[0].options) : (t.rows[0].options ?? tpl.options),
        };
      }
    }

    // ────────────────────────────────────────────── Client + cashier (employee)
    let clientName = "Customer";
    try {
      const c = await pool.query(
        `SELECT "firstName","lastName",email FROM clients WHERE id = $1 LIMIT 1`,
        [order.clientId]
      );
      if (c.rowCount) {
        const r = c.rows[0];
        clientName = [r.firstName, r.lastName].filter(Boolean).join(" ").trim() || clientName;
      }
    } catch {}

    // cashier from orderMeta (preferred)
    let cashierName: string | null = null;
    const metaArr = asArray(order.orderMeta);
    for (const m of metaArr) {
      if (m && typeof m === "object") {
        if (typeof m.cashierName === "string" && m.cashierName.trim()) { cashierName = m.cashierName.trim(); break; }
        if (m.type === "posCheckout" && m.user?.name) { cashierName = String(m.user.name); break; }
      }
    }

    // ────────────────────────────────────────────── Lines (+ simple tax)
    const linesRes = await pool.query(
      `SELECT cp.quantity, cp."unitPrice", p.title, p.sku
         FROM "cartProducts" cp
         JOIN products p ON p.id = cp."productId"
        WHERE cp."cartId" = $1
        ORDER BY cp."createdAt"`,
      [order.cartId]
    );
    const lines = linesRes.rows.map((r: any) => ({
      qty: Number(r.quantity),
      title: r.sku ? `${r.title} (${r.sku})` : r.title,
      unit: Number(r.unitPrice),
      total: Number(r.unitPrice) * Number(r.quantity),
    }));
    const subtotal = lines.reduce((s, l) => s + l.total, 0);
    const discount = Number(order.discountTotal || 0);
    const tax = Number(order.taxTotal || 0);
    const grand = Number(order.totalAmount ?? subtotal - discount + tax);
    const paidRows = await pool.query(
      `SELECT op.amount, COALESCE(pm.name, op."methodId") AS name
         FROM "orderPayments" op
         LEFT JOIN "paymentMethods" pm ON pm.id = op."methodId"
        WHERE op."orderId" = $1
        ORDER BY op."createdAt" ASC NULLS LAST`,
      [order.id]
    );
    const paid = paidRows.rows.reduce((s: number, r: any) => s + Number(r.amount || 0), 0);
    const change = Math.max(0, paid - grand);

    // ────────────────────────────────────────────── PDF layout based on template
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
    const pageSize = tpl.printFormat === "thermal" ? [THERMAL_W, A4.h] : [A4.w, A4.h];
    const page = pdf.addPage(pageSize);
    let y = page.getHeight() - MARGIN;

    const draw = (t: string, size = 10, b = false) => {
      page.drawText(t, { x: MARGIN, y, size, font: b ? bold : font, color: rgb(0, 0, 0) });
      y -= size + 4;
    };
    const right = (t: string, size = 10, b = false) => {
      const w = (b ? bold : font).widthOfTextAtSize(t, size);
      page.drawText(t, { x: page.getWidth() - MARGIN - w, y, size, font: b ? bold : font, color: rgb(0,0,0) });
      y -= size + 4;
    };
    const row = (l: string, r: string, size = 10) => {
      page.drawText(l, { x: MARGIN, y, size, font });
      const w = font.widthOfTextAtSize(r, size);
      page.drawText(r, { x: page.getWidth() - MARGIN - w, y, size, font });
      y -= size + 4;
    };
    const rule = () => {
      y -= 4;
      page.drawLine({
        start: { x: MARGIN, y },
        end: { x: page.getWidth() - MARGIN, y },
        thickness: 0.5,
        color: rgb(0.8, 0.8, 0.8),
      });
      y -= 6;
    };

    // Header
    if (tpl.options.showCompanyName) draw(orgName, 14, true);
    if (tpl.options.headerText) draw(String(tpl.options.headerText), 10);
    if (storeName) draw(storeName, 11, true);
    if (tpl.options.showStoreAddress) {
      for (const ln of addressToLines(storeAddress)) draw(ln, 9);
    }
    rule();

    // Order meta
    row("Date", new Date(order.createdAt ?? order.dateCreated ?? Date.now()).toLocaleString(), 10);
    if (tpl.options.flags.showOrderKey && order.orderKey) row("Receipt", String(order.orderKey), 10);
    row("Customer", clientName, 10);
    if (tpl.options.flags.showCashier && cashierName) row(tpl.options.labels.servedBy || "Served by", cashierName, 10);
    rule();

    // Items
    draw(`${tpl.options.labels.item || "Item"}   ${tpl.options.labels.price || "Price"}`, 10, true);
    for (const l of lines) {
      const left = `${l.qty} × ${l.title}`;
      const rightTxt = fmt(l.total, currency);
      row(left, rightTxt, 10);
    }
    rule();

    // Totals
    row(tpl.options.labels.subtotal || "Subtotal", fmt(subtotal, currency), 10);
    if (!(tpl.options.flags.hideDiscountIfZero && !discount)) {
      row(tpl.options.labels.discount || "Discount", `- ${fmt(discount, currency)}`, 10);
    }
    row(tpl.options.labels.tax || "Tax", fmt(tax, currency), 10);
    draw(`${tpl.options.labels.total || "Total"}  ${fmt(grand, currency)}`, 12, true);
    if (paidRows.rowCount) {
      rule();
      draw("Payments", 10, true);
      for (const p of paidRows.rows) row(p.name, fmt(Number(p.amount || 0), currency), 10);
    }
    if (change > 0) row(tpl.options.labels.change || "Change", fmt(change, currency), 10);

    const pdfBytes = await pdf.save();
    return new NextResponse(Buffer.from(pdfBytes), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="receipt-${order.orderKey || id}.pdf"`,
      },
    });
  } catch (err: any) {
    console.error("[receipt pdf]", err);
    return NextResponse.json({ error: err?.message ?? "Internal error" }, { status: 500 });
  }
}
