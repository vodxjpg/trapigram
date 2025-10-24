import { NextRequest, NextResponse } from "next/server";
import { pgPool as pool } from "@/lib/db";
import { getContext } from "@/lib/context";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

export const runtime = "nodejs";

const A4 = { w: 595.28, h: 841.89 };
const THERMAL_W = 226.77;
const BASE_MARGIN = 12;
const DRAW_RULES = false;

const log = (...a: any[]) => console.log("[pos:receipt-pdf]", ...a);
const warn = (...a: any[]) => console.warn("[pos:receipt-pdf][warn]", ...a);
const err = (...a: any[]) => console.error("[pos:receipt-pdf][error]", ...a);

function addressToLines(addr: any): string[] {
  if (!addr) return [];
  const line1 = [addr.street, addr.street2].filter(Boolean).join(", ");
  const line2 = [addr.city, addr.state, addr.postal || addr.zip].filter(Boolean).join(", ");
  const line3 = [addr.country].filter(Boolean).join(", ");
  return [line1, line2, line3].filter(Boolean);
}
function fmt(n: number, c = "USD", l = "en-US") {
  return new Intl.NumberFormat(l, { style: "currency", currency: c }).format(n || 0);
}
function asArray(x: any) { try { return Array.isArray(x) ? x : JSON.parse(x); } catch { return []; } }
function parseJSONish<T = any>(v: any): T | null {
  if (v == null) return null;
  if (typeof v === "string") { try { return JSON.parse(v) as T; } catch { return null; } }
  if (typeof v === "object") return v as T;
  return null;
}
function containBox(imgW: number, imgH: number, maxW: number, maxH: number) {
  const s = Math.min(maxW / imgW, maxH / imgH, 1);
  return { w: imgW * s, h: imgH * s };
}
async function tryEmbedImage(pdf: PDFDocument, req: NextRequest, url: string) {
  try {
    if (!url) return null;
    if (/^data:image\/(png|jpe?g);base64,/i.test(url)) {
      const bytes = Uint8Array.from(Buffer.from(url.split(",")[1], "base64"));
      try { return await pdf.embedPng(bytes); } catch { }
      try { return await pdf.embedJpg(bytes); } catch { }
      return null;
    }
    const origin = process.env.NEXT_PUBLIC_APP_URL || new URL(req.url).origin;
    const src = /^https?:\/\//i.test(url) ? url : `${origin}${url}`;
    const res = await fetch(src, { cache: "no-store" });
    if (!res.ok) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    const ct = (res.headers.get("content-type") || "").toLowerCase();
    const ext = (src.split(".").pop() || "").toLowerCase();
    const looksPng = ct.includes("png") || ext === "png";
    const looksJpg = ct.includes("jpeg") || ct.includes("jpg") || ext === "jpg" || ext === "jpeg";
    try { if (looksPng) return await pdf.embedPng(bytes); if (looksJpg) return await pdf.embedJpg(bytes); } catch { }
    try { return await pdf.embedPng(bytes); } catch { }
    try { return await pdf.embedJpg(bytes); } catch { }
    return null;
  } catch { return null; }
}
async function resolveStoreId(order: any, orgId: string) {
  const meta = asArray(order?.orderMeta) || [];
  let storeId: string | null = null, registerId: string | null = null;
  if (typeof order?.channel === "string") {
    const m = /^pos-([^-\s]+)-([^-\s]+)$/i.exec(order.channel);
    if (m) { storeId = m[1] !== "na" ? m[1] : null; registerId = m[2] !== "na" ? m[2] : null; }
  }
  if (!storeId || !registerId) {
    for (const m of meta) {
      if (!m || typeof m !== "object") continue;
      if (!storeId && typeof m.storeId === "string") storeId = m.storeId;
      if (!registerId && typeof m.registerId === "string") registerId = m.registerId;
      if (m.type === "posCheckout") {
        if (!storeId && typeof m.storeId === "string") storeId = m.storeId;
        if (!registerId && typeof m.registerId === "string") registerId = m.registerId;
      }
    }
  }
  if (!storeId && registerId) {
    const r = await pool.query(
      `SELECT "storeId" FROM registers WHERE id = $1 AND "organizationId" = $2 LIMIT 1`,
      [registerId, orgId]
    );
    if (r.rowCount) storeId = r.rows[0].storeId;
  }
  return { storeId, registerId };
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { id } = await params;

  try {
    const { rows: ordRows } = await pool.query(
      `SELECT * FROM orders WHERE id = $1 AND "organizationId" = $2 LIMIT 1`,
      [id, ctx.organizationId]
    );
    if (!ordRows.length) return NextResponse.json({ error: "Order not found" }, { status: 404 });
    const order: any = ordRows[0];

    let orgName = process.env.NEXT_PUBLIC_APP_NAME || "Store";
    let currency = process.env.NEXT_PUBLIC_DEFAULT_CURRENCY || "USD";
    try {
      const org = await pool.query(`SELECT name, metadata FROM organizations WHERE id = $1`, [ctx.organizationId]);
      if (org.rowCount) {
        orgName = org.rows[0].name ?? orgName;
        const meta = typeof org.rows[0].metadata === "string" ? JSON.parse(org.rows[0].metadata) : org.rows[0].metadata ?? {};
        currency = meta?.currency || currency;
      }
    } catch { }

    const { storeId } = await resolveStoreId(order, ctx.organizationId);

    let storeName: string | null = null;
    let storeAddress: any = null;
    let defaultTemplateId: string | null = null;
    if (storeId) {
      const s = await pool.query(
        `SELECT id,name,address,"defaultReceiptTemplateId" FROM stores WHERE id=$1 AND "organizationId"=$2 LIMIT 1`,
        [storeId, ctx.organizationId]
      );
      if (s.rowCount) {
        storeName = s.rows[0].name ?? null;
        storeAddress = parseJSONish(s.rows[0].address);
        defaultTemplateId = s.rows[0].defaultReceiptTemplateId ?? null;
      }
    }

    const tplOverride = new URL(req.url).searchParams.get("templateId");
    let tpl = {
      id: null as string | null,
      printFormat: "thermal" as "thermal" | "a4",
      options: {
        showLogo: true,
        logoUrl: null as string | null,
        showCompanyName: true,
        displayCompanyFirst: false,
        headerText: null as string | null,
        showStoreAddress: false,
        labels: {
          item: "Item", price: "Price", subtotal: "Subtotal", discount: "Discount",
          tax: "Tax", total: "Total", change: "Change", outstanding: "Outstanding",
          servedBy: "Served by",
        },
        flags: { hideDiscountIfZero: true, printBarcode: true, showOrderKey: true, showCashier: true, showSku: false },
      },
    };
    const tplId = tplOverride || defaultTemplateId;
    if (tplId) {
      const t = await pool.query(
        `SELECT id,"printFormat",options FROM "posReceiptTemplates" WHERE id=$1 AND "organizationId"=$2 LIMIT 1`,
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

    // ── Layout (bigger gaps)
    const isThermal = tpl.printFormat === "thermal";
    const margin = isThermal ? BASE_MARGIN : 18;
    const BASE = isThermal ? 8 : 10;
    const SMALL = isThermal ? 7 : 9;
    const BIG = isThermal ? 10 : 12;
    const LEAD = isThermal ? 3.4 : 5.2;            // ↑ was 2.5 / 4
    const SECTION_GAP = isThermal ? 10 : 14;       // between blocks
    const RULE_GAP = isThermal ? 12 : 16;          // when rule() is called with DRAW_RULES=false

    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
    const pageSize = isThermal ? [THERMAL_W, A4.h] : [A4.w, A4.h];
    const page = pdf.addPage(pageSize);
    let y = page.getHeight() - margin;

    const drawLeft = (t: string, size = BASE, b = false) => {
      page.drawText(String(t), { x: margin, y, size, font: b ? bold : font, color: rgb(0, 0, 0) });
      y -= size + LEAD;
    };
    const drawCenter = (t: string, size = BASE, b = false) => {
      const w = (b ? bold : font).widthOfTextAtSize(String(t), size);
      page.drawText(String(t), { x: (page.getWidth() - w) / 2, y, size, font: b ? bold : font, color: rgb(0, 0, 0) });
      y -= size + LEAD;
    };
    const row = (l: string, r: string, size = BASE) => {
      page.drawText(String(l), { x: margin, y, size, font });
      const w = font.widthOfTextAtSize(String(r), size);
      page.drawText(String(r), { x: page.getWidth() - margin - w, y, size, font });
      y -= size + LEAD;
    };
    const spacer = (h = SECTION_GAP) => { y -= h; };
    const rule = () => {
      if (!DRAW_RULES) { spacer(RULE_GAP); return; }
      y -= 2;
      page.drawLine({ start: { x: margin, y }, end: { x: page.getWidth() - margin, y }, thickness: 0.5, color: rgb(0.8, 0.8, 0.8) });
      y -= 6;
    };

    // ── Logo with bigger bottom margin
    if (tpl.options?.showLogo && tpl.options?.logoUrl) {
      const img = await tryEmbedImage(pdf, req, tpl.options.logoUrl);
      if (img) {
        const maxW = page.getWidth() - 2 * margin;
        const maxH = isThermal ? 60 : 90;
        const { w: drawW, h: drawH } = containBox(img.width, img.height, maxW, maxH);
        page.drawImage(img, { x: (page.getWidth() - drawW) / 2, y: y - drawH, width: drawW, height: drawH });
        y -= drawH + (isThermal ? 14 : 18);       // ↑ more space under the logo
      }
    }

    // ── Header block (company optional), more air between groups
    const wantCompany = !!(tpl.options?.showCompanyName) && !!orgName?.trim() && orgName.trim().toLowerCase() !== "store";
    if (tpl.options?.displayCompanyFirst && wantCompany) drawCenter(orgName, BIG, true);

    if (storeName) drawCenter(storeName, BIG, true);
    if (tpl.options?.showStoreAddress) for (const ln of addressToLines(storeAddress)) drawCenter(ln, SMALL);
    if (!tpl.options?.displayCompanyFirst && wantCompany) drawCenter(orgName, SMALL, true);
    if (tpl.options?.headerText) drawCenter(String(tpl.options.headerText), SMALL);

    spacer(); // extra gap after header block

    // ── Meta
    row("Date", new Date(order.createdAt ?? order.dateCreated ?? Date.now()).toLocaleString(), BASE);
    if (tpl.options?.flags?.showOrderKey && order.orderKey) row("Receipt", String(order.orderKey), BASE);
    row("Customer", (await (async () => {
      try {
        const c = await pool.query(
          `SELECT "firstName","lastName" FROM clients WHERE id=$1 LIMIT 1`,
          [order.clientId]
        );
        if (c.rowCount) {
          const r = c.rows[0];
          return [r.firstName, r.lastName].filter(Boolean).join(" ").trim() || "Customer";
        }
      } catch { }
      return "Customer";
    })()), BASE);

    if (tpl.options?.flags?.showCashier) {
      let cashierName: string | null = null;
      for (const m of asArray(order.orderMeta)) {
        if (m && typeof m === "object") {
          if (typeof m.cashierName === "string" && m.cashierName.trim()) { cashierName = m.cashierName.trim(); break; }
          if (m.type === "posCheckout" && m.user?.name) { cashierName = String(m.user.name); break; }
        }
      }
      if (cashierName) row(tpl.options?.labels?.servedBy || "Served by", cashierName, BASE);
    }

    spacer(); // gap before items

    // ── Items
    const showSku = !!(tpl.options?.flags?.showSku);
    const linesRes = await pool.query(
      `SELECT cp.quantity, cp."unitPrice", p.title, p.sku
         FROM "cartProducts" cp
         JOIN products p ON p.id = cp."productId"
        WHERE cp."cartId" = $1
        ORDER BY cp."createdAt"`,
      [order.cartId]
    );
    const lines = linesRes.rows.map((r: any) => {
      const name = showSku && r.sku ? `${r.title} (${r.sku})` : r.title;
      const qty = Number(r.quantity);
      const unit = Number(r.unitPrice);
      return { qty, title: name, unit, total: unit * qty };
    });

    drawLeft(`${tpl.options?.labels?.item || "Item"}   ${tpl.options?.labels?.price || "Price"}`, BASE, true);
    for (const l of lines) row(`${l.qty} × ${l.title}`, fmt(l.total, currency), BASE);

    spacer(); // gap before totals

    // ── Totals / payments
    const subtotal = lines.reduce((s, l) => s + l.total, 0);
    const discount = Number(order.discountTotal || 0);
    const tax = Number(order.taxTotal || 0);
    const grand = Number(order.totalAmount ?? subtotal - discount + tax);

    row(tpl.options?.labels?.subtotal || "Subtotal", fmt(subtotal, currency), BASE);
    if (!(tpl.options?.flags?.hideDiscountIfZero && !discount))
      row(tpl.options?.labels?.discount || "Discount", `- ${fmt(discount, currency)}`, BASE);
    row(tpl.options?.labels?.tax || "Tax", fmt(tax, currency), BASE);
    drawLeft(`${tpl.options?.labels?.total || "Total"}  ${fmt(grand, currency)}`, BIG, true);

    const paidRows = await pool.query(
      `SELECT op.amount, COALESCE(pm.name, op."methodId") AS name
         FROM "orderPayments" op
         LEFT JOIN "paymentMethods" pm ON pm.id = op."methodId"
        WHERE op."orderId" = $1
        ORDER BY op."createdAt" ASC NULLS LAST`,
      [order.id]
    );
    const paid = paidRows.rows.reduce((s: number, r: any) => s + Number(r.amount || 0), 0);
    if (paidRows.rowCount) {
      spacer();
      drawLeft("Payments", BASE, true);
      for (const p of paidRows.rows) row(p.name, fmt(Number(p.amount || 0), currency), BASE);
    }
    const change = Math.max(0, paid - grand);
    if (change > 0) row(tpl.options?.labels?.change || "Change", fmt(change, currency), BASE);

    const pdfBytes = await pdf.save();
    return new NextResponse(Buffer.from(pdfBytes), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="receipt-${order.orderKey || id}.pdf"`,
      },
    });
  } catch (e: any) {
    err("Unhandled error", String(e));
    return NextResponse.json({ error: e?.message ?? "Internal error" }, { status: 500 });
  }
}
