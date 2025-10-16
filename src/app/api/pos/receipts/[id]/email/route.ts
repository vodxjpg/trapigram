// src/app/api/pos/receipts/[id]/email/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getContext } from "@/lib/context";
import { pgPool as pool } from "@/lib/db";
import { sendEmail } from "@/lib/email";

export const runtime = "nodejs";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;

  const { id } = await params;

  try {
    const body = await req.json().catch(() => ({} as any));
    const toOverride =
      typeof body?.to === "string" && body.to.trim().length ? body.to.trim() : undefined;

    // Ensure the order belongs to this org
    const { rows: orderRows } = await pool.query(
      `SELECT id,"organizationId","clientId","orderKey"
         FROM orders
        WHERE id = $1 AND "organizationId" = $2
        LIMIT 1`,
      [id, ctx.organizationId],
    );
    if (!orderRows.length)
      return NextResponse.json({ error: "Order not found" }, { status: 404 });

    const ord = orderRows[0];

    // Get client email/name
    const { rows: clientRows } = await pool.query(
      `SELECT email,"firstName","lastName"
         FROM clients
        WHERE id = $1
        LIMIT 1`,
      [ord.clientId],
    );
    const client = clientRows[0] ?? {};
    const to = toOverride ?? client?.email ?? "";

    if (!to) {
      return NextResponse.json(
        { error: "No recipient email provided or on file." },
        { status: 400 },
      );
    }

    const origin = process.env.NEXT_PUBLIC_APP_URL || new URL(req.url).origin;
    const pdfUrl = `${origin}/api/pos/receipts/${ord.id}/pdf`;
    const name =
      [client?.firstName, client?.lastName].filter(Boolean).join(" ").trim() || "there";
    const subject = `Receipt ${ord.orderKey ?? ord.id}`;

    // Fetch the PDF so we can attach it
    const pdfRes = await fetch(pdfUrl, {
      // forward cookies so the PDF route can auth with the same session
      headers: { Cookie: req.headers.get("cookie") ?? "" },
    });
    if (!pdfRes.ok) {
      const msg = await pdfRes.text().catch(() => "");
      throw new Error(`Failed to render receipt PDF (${pdfRes.status}): ${msg || "unknown error"}`);
    }
    const pdfBuf = Buffer.from(await pdfRes.arrayBuffer());

    const html = `
      <p>Hi ${name},</p>
      <p>Thanks for your purchase. Your receipt is attached as a PDF.</p>
      <p>If you have trouble opening the attachment, you can also view it here:<br/>
      <a href="${pdfUrl}">${pdfUrl}</a></p>
      <p>— ${process.env.NEXT_PUBLIC_APP_NAME || "Our Store"}</p>
    `;
    const text = `Hi ${name},

Thanks for your purchase. Your receipt is attached as a PDF.

If you have trouble opening the attachment, you can also view it here:
${pdfUrl}

— ${process.env.NEXT_PUBLIC_APP_NAME || "Our Store"}
`;

    await sendEmail({
      to,
      subject,
      text,
      html,
      attachments: [
        {
          filename: `receipt-${ord.orderKey ?? ord.id}.pdf`,
          content: pdfBuf,
          contentType: "application/pdf",
        },
      ],
    });

    return NextResponse.json({ ok: true, attached: true }, { status: 200 });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message ?? "Unable to send receipt" },
      { status: 500 },
    );
  }
}
