// src/app/api/tier-pricing/check-product/[id]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getContext } from "@/lib/context";
import { getStepsFor, getPriceForQuantity, tierPricing } from "@/lib/tier-pricing";
import { v4 as uuidv4 } from "uuid";

const LOG = "[TIER_PRICING_CHECK]";
const mkRid = () => uuidv4().slice(0, 8);

const paramsSchema = z.object({
  // Product or variation id (shared copies may be non-UUID strings)
  id: z.string().min(1),
});

const bodySchema = z.object({
  quantity: z.number().int().positive(),
  clientCountry: z.string().length(2),
  // Back-compat: callers may still send customerId; prefer clientId when both exist
  clientId: z.string().min(1).optional(),
  customerId: z.string().min(1).optional(),
});

/* POST – compute price for a product/variation given qty & country (+client targeting) */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const rid = mkRid();
  const t0 = Date.now();

  try {
    const ctx = await getContext(req);
    if (ctx instanceof NextResponse) return ctx;
    const { organizationId } = ctx;

    const { id } = paramsSchema.parse(await params);

    let parsed: z.infer<typeof bodySchema>;
    try {
      parsed = bodySchema.parse(await req.json());
    } catch (e) {
      if (e instanceof z.ZodError) {
        console.error(`${LOG}#${rid} body validation error`, { issues: e.issues });
        return NextResponse.json({ error: e.issues }, { status: 400 });
      }
      console.error(`${LOG}#${rid} body parse error`, e);
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const quantity = parsed.quantity;
    const country = parsed.clientCountry.toUpperCase();
    // Back-compat alias: prefer clientId, fallback to legacy customerId
    const clientId = (parsed.clientId ?? parsed.customerId) ?? null;

    console.log(`${LOG}#${rid} start`, {
      organizationId,
      id,
      quantity,
      country,
      clientId,
    });

    const tiers = await tierPricing(organizationId);
    console.log(`${LOG}#${rid} loaded tiers`, { count: tiers.length });

    const steps = getStepsFor(tiers, country, id, clientId || undefined);
    const price = getPriceForQuantity(steps, quantity);

    console.log(`${LOG}#${rid} result`, {
      stepsCount: steps.length,
      price,
      ms: Date.now() - t0,
    });

    return NextResponse.json({ price }, { status: 200 });
  } catch (error) {
    console.error(`${LOG}#${rid} error`, error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
