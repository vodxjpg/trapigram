// /home/zodx/Desktop/trapigram/src/app/api/product-categories/check-slug/route.ts

import { NextRequest, NextResponse } from "next/server"
import { Pool } from "pg"
import { auth } from "@/lib/auth"

// Initialize database connection (matching internal endpoint style)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
})

// API key for public endpoints (assuming this is a public endpoint; adjust if internal)
const PUBLIC_API_KEY = process.env.PUBLIC_API_KEY as string

export async function GET(req: NextRequest) {
  try {
    // Check API key for public access (remove if this should be internal-only)
    const apiKey = req.headers.get("x-api-key")
    if (apiKey !== PUBLIC_API_KEY) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
    }

    // Check session
    const session = await auth.api.getSession({ headers: req.headers })
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const organizationId = session.session.activeOrganizationId
    if (!organizationId) {
      console.log("No active organization, redirecting to /select-organization")
      return NextResponse.json({ redirect: "/select-organization" }, { status: 400 })
    }

    const { searchParams } = new URL(req.url)
    const slug = searchParams.get("slug")
    const categoryId = searchParams.get("categoryId")

    if (!slug) {
      return NextResponse.json({ error: "Slug is required" }, { status: 400 })
    }

    const parsedCategoryId = categoryId ? Number.parseInt(categoryId) : null

    // Query to check if slug exists
    let queryText = `
      SELECT id FROM product_categories
      WHERE "organizationId" = $1 AND "slug" = $2
    `
    const queryValues: any[] = [organizationId, slug]

    if (parsedCategoryId) {
      queryText += ` AND "id" != $3`
      queryValues.push(parsedCategoryId)
    }

    const result = await pool.query(queryText, queryValues)
    const existingCategory = result.rows.length > 0

    return NextResponse.json({ exists: existingCategory }, { status: 200 })
  } catch (error) {
    console.error("[GET /api/product-categories/check-slug] error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}