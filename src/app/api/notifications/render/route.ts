// /src/app/api/notifications/render/route.ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getContext } from "@/lib/context";
import { renderNotification } from "@/lib/notifications";
import { db } from "@/lib/db";

const schema = z.object({
  type: z.string().min(1),
  variables: z.record(z.string()).optional().default({}),
  trigger: z.string().optional().nullable(),          // e.g. "admin_only"
  channel: z.enum(["telegram"]).default("telegram"),
  subject: z.string().optional(),
  // Optional helpers to auto-resolve country for country-scoped templates
  country: z.string().length(2).optional(),
  clientId: z.string().uuid().optional(),
  ticketId: z.string().uuid().optional(),
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

  const { organizationId } = ctx;

  // Resolve country: explicit > clientId > ticketId > null
  let country: string | null = body.country ? body.country.toUpperCase() : null;
  try {
    if (!country && body.clientId) {
      const c = await db
        .selectFrom("clients")
        .select(["country"])
        .where("id", "=", body.clientId)
        .where("organizationId", "=", organizationId)
        .executeTakeFirst();
      country = (c?.country as string | null) ?? null;
    }
    if (!country && body.ticketId) {
      const t = await db
        .selectFrom("tickets as t")
        .leftJoin("clients as c", "c.id", "t.clientId")
        .select(["c.country"])
        .where("t.id", "=", body.ticketId)
        .where("t.organizationId", "=", organizationId)
        .executeTakeFirst();
      country = (t?.country as string | null) ?? null;
    }
  } catch {
    // ignore lookup errors; fall back to null
  }

  const rendered = await renderNotification({
    organizationId,
    type: body.type as any,        // NotificationType is enforced in notifications.ts
    channel: body.channel,         // "telegram"
    trigger: body.trigger ?? null,
    variables: body.variables ?? {},
    subject: body.subject,
    country,
    // Optional: force admin template if you’re rendering for support groups
    role: body.trigger === "admin_only" ? "admin" : "user",
  });

  return NextResponse.json(rendered, { status: 200 });
}
