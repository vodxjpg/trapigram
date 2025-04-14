import { type NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"

export async function GET(req: NextRequest) {
  const apiKey = req.headers.get("x-api-key")
  const internalSecret = req.headers.get("x-internal-secret")
  let organizationId: string

  if (apiKey) {
    const { valid, error, key } = await auth.api.verifyApiKey({ body: { key: apiKey } })
    if (!valid || !key) {
      return NextResponse.json({ error: error?.message || "Invalid API key" }, { status: 401 })
    }
    const session = await auth.api.getSession({ headers: req.headers })
    organizationId = session?.session.activeOrganizationId || ""
    if (!organizationId) {
      return NextResponse.json({ error: "No active organization" }, { status: 400 })
    }
  } else {
    const session = await auth.api.getSession({ headers: req.headers })
    if (!session) {
      return NextResponse.json({ error: "Unauthorized: No session found" }, { status: 403 })
    }
    organizationId = session.session.activeOrganizationId
    if (!organizationId) {
      return NextResponse.json({ error: "No active organization in session" }, { status: 400 })
    }
  }

  const { searchParams } = new URL(req.url)
  const sku = searchParams.get("sku")

  if (!sku) {
    return NextResponse.json({ error: "SKU is required" }, { status: 400 })
  }

  try {
    // Simulate SKU check
    const takenSkus = ["SKU-1001", "SKU-1002", "SKU-1003"]
    const exists = takenSkus.includes(sku)

    return NextResponse.json({ exists })
  } catch (error) {
    console.error("[GET /api/products/check-sku] error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
