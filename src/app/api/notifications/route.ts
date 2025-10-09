// src/app/api/notifications/route.ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getContext } from "@/lib/context";
import { sendNotification, type NotificationChannel } from "@/lib/notifications";

const schema = z.object({
  type: z.string().min(1),
  message: z.string().min(1),
  country: z.string().length(2).optional().nullable(),
  channels: z.array(
    z.enum(["email", "in_app", "webhook", "telegram"] as NotificationChannel[])
  ),
  userId: z.string().uuid().optional().nullable(),
  clientId: z.string().uuid().optional().nullable(),
  trigger: z.string().optional().nullable(),
  /** NEW: allow passing orderId so server resolves org/client correctly */
  orderId: z.string().uuid().optional().nullable(),
  /** optional ticketId – already supported downstream but allow here too just in case */
  ticketId: z.string().uuid().optional().nullable(),
  subject: z.string().optional(),
  variables: z.record(z.string()).optional(),
  url: z.string().url().optional().nullable(),
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

  await sendNotification({
    ...body,
    organizationId: ctx.organizationId,
  });

  return NextResponse.json({ ok: true }, { status: 201 });
}
