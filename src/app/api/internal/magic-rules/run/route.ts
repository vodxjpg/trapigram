// src/app/api/internal/magic-rules/run/route.ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getContext } from "@/lib/context";
import {
  runMagicRules,
  RulesPayloadSchema,
  type EventPayload,
} from "@/lib/magic-rules";

/**
 * POST /api/internal/magic-rules/run
 * Secure internal endpoint to evaluate Magic Rules for a single event.
 *
 * Auth: same as your other internal routes – requires x-internal-secret OR a logged-in context.
 * We accept either:
 *  - Header "x-internal-secret" === process.env.INTERNAL_API_SECRET, OR
 *  - Standard session context via getContext(req)
 *
 * Body:
 * {
 *   event: {
 *     organizationId: string,
 *     clientId: string,
 *     userId?: string | null,
 *     country?: string | null,
 *     type: "order_paid" | "manual" | "sweep",
 *     // facts per type (see lib)
 *   },
 *   rules: MagicRule[]                      // use the schema we defined
 * }
 */

const EventBase = z.object({
  organizationId: z.string().min(1),
  clientId: z.string().min(1),
  userId: z.string().uuid().optional().nullable(),
  country: z.string().length(2).optional().nullable(),
});

const EventOrderPaid = EventBase.extend({
  type: z.literal("order_paid"),
  orderId: z.string().uuid(),
  purchasedProductIds: z.array(z.string().min(1)).min(1),
  purchasedAtISO: z.string().min(1),
  baseAffiliatePointsAwarded: z.number().int().optional(),
});

const EventManual = EventBase.extend({
  type: z.literal("manual"),
});

const EventSweep = EventBase.extend({
  type: z.literal("sweep"),
  daysSinceLastPurchase: z.number().int().optional(),
});

const EventSchema = z.discriminatedUnion("type", [
  EventOrderPaid,
  EventManual,
  EventSweep,
]);

const BodySchema = z.object({
  event: EventSchema,
  rules: RulesPayloadSchema,
});

export async function POST(req: NextRequest) {
  // Allow either internal-secret or normal ctx (owner hitting from dashboard).
  const hdrSecret = req.headers.get("x-internal-secret") || "";
  const envSecret = process.env.INTERNAL_API_SECRET || "";

  const ctx = await getContext(req);
  const ctxOk = !(ctx instanceof NextResponse);

  if (!ctxOk && (!hdrSecret || hdrSecret !== envSecret)) {
    return NextResponse.json(
      { error: "Unauthorized (need valid session or x-internal-secret)" },
      { status: 401 },
    );
  }

  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await req.json());
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: e.errors }, { status: 400 });
    }
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  // Enforce organizationId if we do have a valid ctx
  if (ctxOk) {
    const { organizationId } = ctx;
    if (body.event.organizationId !== organizationId) {
      return NextResponse.json(
        { error: "organizationId mismatch" },
        { status: 403 },
      );
    }
  }

  try {
    const results = await runMagicRules(body.event as EventPayload, body.rules);
    return NextResponse.json({ ok: true, results }, { status: 200 });
  } catch (e: any) {
    console.error("[magic-rules/run] error", { message: e?.message || String(e) });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
