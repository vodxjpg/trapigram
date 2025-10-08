// src/app/api/notification/route.ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getContext } from "@/lib/context";
import { sendNotification, type NotificationChannel } from "@/lib/notifications";

const schema = z.object({
  type: z.string().min(1),
  message: z.string().min(1),
  country: z.string().length(2).optional().nullable(),
  channels: z.array(z.enum(["email", "in_app", "webhook", "telegram"] as NotificationChannel[])),
  userId: z.string().uuid().optional().nullable(),
  clientId: z.string().uuid().optional().nullable(),
  trigger: z.string().optional().nullable(),
});

export async function POST(req: NextRequest) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;

  let body: z.infer<typeof schema>;
  try {
    body = schema.parse(await req.json());
  } catch (err) {
    if (err instanceof z.ZodError)
      return NextResponse.json({ error: err.errors }, { status: 400 });
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }


// Normalize order-note trigger to admin_only at the edge as well,
// and normalize country to UPPERCASE to match stored support-group codes.
const normalizedBase =
  body.type === "order_message" &&
  (!body.trigger || body.trigger === "order_note")
    ? { ...body, trigger: "admin_only" as const }
    : body;

  const normalized: typeof normalizedBase = {
    ...normalizedBase,
    country:
      typeof normalizedBase.country === "string" && normalizedBase.country.length === 2
        ? normalizedBase.country.toUpperCase()
        : normalizedBase.country ?? null,
  };

  await sendNotification({ ...normalized, organizationId: ctx.organizationId });

  return NextResponse.json({ ok: true }, { status: 201 });
}