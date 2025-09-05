// src/app/api/tier-pricing/check-product/[id]/route.ts
import { NextRequest, NextResponse } from "next/server"
import { getContext } from "@/lib/context"
import { getStepsFor, getPriceForQuantity, tierPricing } from "@/lib/tier-pricing"
import { v4 as uuidv4 } from "uuid"

const LOG = "[TIER_PRICING_CHECK]";
const mkRid = () => uuidv4().slice(0, 8);

/* POST – compute price for a product/variation given qty & country */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const rid = mkRid()
  const t0 = Date.now()
  try {
    const ctx = await getContext(req)
    if (ctx instanceof NextResponse) return ctx
    const { organizationId } = ctx

    const { id } = await params

    let body: any
    try {
      body = await req.json()
    } catch (e) {
      console.error(`${LOG}#${rid} body parse error`, e)
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
    }

    const quantity = Number(body?.quantity)
    const country = body?.clientCountry
    console.log(`${LOG}#${rid} start`, { organizationId, id, quantity, country })

    const tierPricings = await tierPricing(organizationId)
    const tiers = tierPricings
    console.log(`${LOG}#${rid} loaded tiers`, { count: tiers.length })

    const steps = getStepsFor(tiers, country, id)
    const price = getPriceForQuantity(steps, quantity)

    console.log(`${LOG}#${rid} result`, {
      stepsCount: steps.length,
      price,
      ms: Date.now() - t0,
    })

    return NextResponse.json({ price }, { status: 200 })
  } catch (error) {
    console.error(`${LOG}#${rid} error`, error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
