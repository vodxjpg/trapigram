// src/app/api/notification-templates/[id]/route.ts
export const runtime = "nodejs";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getContext } from "@/lib/context";
import { db } from "@/lib/db";
import type { NotificationType } from "@/lib/notifications";

const NOTIF_TYPES: Readonly<NotificationType[]> = [
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
] as const;

const schema = z.object({
  type: z.enum(NOTIF_TYPES),
  role: z.enum(["admin", "user"]),
  countries: z
    .array(z.string().length(2))
    .min(1, "Select at least one country"),
  subject: z.string().min(1),
  message: z.string().min(1),
});

export async function GET(
  _: NextRequest,
  { params }: { params: { id: string } },
) {
  const row = await db
    .selectFrom("notificationTemplates")
    .selectAll()
    .where("id", "=", params.id)
    .executeTakeFirst();

  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });

  /* parse to array */
  const parsed = {
    ...row,
    countries: Array.isArray(row.countries)
      ? row.countries
      : JSON.parse(row.countries || "[]"),
  };

  return NextResponse.json(parsed, { status: 200 });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;

  let body: z.infer<typeof schema>;
  try {
    body = schema.parse(await req.json());
  } catch (err) {
    if (err instanceof z.ZodError)
      return NextResponse.json({ error: err.errors }, { status: 400 });
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  await db
    .updateTable("notificationTemplates")
    .set({
      ...body,
      countries: JSON.stringify(body.countries),
      updatedAt: new Date(),
    })
    .where("id", "=", params.id)
    .where("organizationId", "=", ctx.organizationId)
    .executeTakeFirst();

  return NextResponse.json({ ok: true }, { status: 200 });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;

  await db
    .deleteFrom("notificationTemplates")
    .where("id", "=", params.id)
    .where("organizationId", "=", ctx.organizationId)
    .executeTakeFirst();

  return new NextResponse(null, { status: 204 });
}
