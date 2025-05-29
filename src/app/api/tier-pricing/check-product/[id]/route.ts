// src/app/api/tier-pricing/route.ts
import { NextRequest, NextResponse } from "next/server"
import { getContext } from "@/lib/context"
import { getStepsFor, getPriceForQuantity, tierPricing } from "@/lib/tier-pricing"


/* ─── GET list ────────────────────────── */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> },
) {
    const ctx = await getContext(req)
    if (ctx instanceof NextResponse) return ctx
    const { organizationId } = ctx
    const body = await req.json();

    try {
        const { id } = await params;
        const { quantity, clientCountry: country } = body

        const tierPricings = await tierPricing(organizationId)
        const tiers: Tier[] = tierPricings;

        const steps = getStepsFor(tiers, country, id);
        const price = getPriceForQuantity(steps, quantity);

        return NextResponse.json({ price }, { status: 200 });
    } catch (error) {
        console.error("[GET /api/tier-pricing/check-product/:id] error:", error);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}