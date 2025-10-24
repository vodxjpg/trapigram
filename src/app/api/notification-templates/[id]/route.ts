// src/app/api/notification-templates/[id]/route.ts
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getContext } from "@/lib/context";
import { db } from "@/lib/db";
import type { NotificationType } from "@/lib/notifications";

const NOTIF_TYPES = [
  "order_placed",
  "order_pending_payment",
  "order_paid",
  "order_completed",
  "order_cancelled",
  "order_refunded",
  "order_partially_paid",
  "order_shipped",
  "ticket_created",
  "ticket_replied",
  "order_message",
] as const satisfies readonly NotificationType[];

const schema = z.object({
  type: z.enum(NOTIF_TYPES),
  role: z.enum(["admin", "user"]),
  countries: z.array(z.string().length(2)).min(1, "Select at least one country"),
  subject: z.string().min(1),
  message: z.string().min(1),
});

/* ─────────────── GET ─────────────── */
export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> } // Next 16: params is async
) {
  const { id } = await context.params;

  const row = await db
    .selectFrom("notificationTemplates")
    .selectAll()
    .where("id", "=", id)
    .executeTakeFirst();

  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const parsed = {
    ...row,
    countries: Array.isArray((row as any).countries)
      ? (row as any).countries
      : (() => {
        try {
          return JSON.parse((row as any).countries || "[]");
        } catch {
          return [];
        }
      })(),
  };

  return NextResponse.json(parsed, { status: 200 });
}

/* ─────────────── PATCH ─────────────── */
export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;

  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;

  let body: z.infer<typeof schema>;
  try {
    body = schema.parse(await req.json());
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.errors }, { status: 400 });
    }
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  await db
    .updateTable("notificationTemplates")
    .set({
      ...body,
      countries: JSON.stringify(body.countries),
      updatedAt: new Date(),
    })
    .where("id", "=", id)
    .where("organizationId", "=", ctx.organizationId)
    .executeTakeFirst();

  return NextResponse.json({ ok: true }, { status: 200 });
}

/* ─────────────── DELETE ─────────────── */
export async function DELETE(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;

  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;

  await db
    .deleteFrom("notificationTemplates")
    .where("id", "=", id)
    .where("organizationId", "=", ctx.organizationId)
    .executeTakeFirst();

  return new NextResponse(null, { status: 204 });
}
