import { type NextRequest, NextResponse } from "next/server"
import { getContext } from "@/lib/context";

export async function GET(req: NextRequest) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;

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
