// /home/zodx/Desktop/trapigram/src/app/api/product-categories/route.ts

import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { Pool } from "pg"
import { auth } from "@/lib/auth"
import { slugify } from "@/lib/utils"
import { v4 as uuidv4 } from "uuid"

// Initialize database connection (matching internal endpoint style)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
})

// API key for public endpoints (stored in environment variables)
const PUBLIC_API_KEY = process.env.PUBLIC_API_KEY as string

// Schema for category validation (unchanged)
const categorySchema = z.object({
  name: z.string().min(1, "Name is required"),
  slug: z.string().optional(),
  image: z.string().nullable().optional(),
  order: z.number().default(0),
  parentId: z.number().nullable().optional(),
  organizationId: z.string(),
})

export async function GET(req: NextRequest) {
  try {
    // Check API key for public access
    const apiKey = req.headers.get("x-api-key")
    if (apiKey !== PUBLIC_API_KEY) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
    }

    // Check session (optional, depending on your public API requirements)
    const session = await auth.api.getSession({ headers: req.headers })
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const organizationId = session.session.activeOrganizationId
    if (!organizationId) {
      return NextResponse.json({ error: "No active organization" }, { status: 400 })
    }

    const { searchParams } = new URL(req.url)
    const search = searchParams.get("search") || ""
    const page = Number.parseInt(searchParams.get("page") || "1")
    const pageSize = Number.parseInt(searchParams.get("pageSize") || "10")
    const skip = (page - 1) * pageSize

    // Query categories (using node-postgres instead of Kysely for consistency)
    const categoriesQuery = `
      SELECT * FROM product_categories
      WHERE "organizationId" = $1
      AND "name" ILIKE $2
      ORDER BY "order" ASC
      OFFSET $3 LIMIT $4
    `
    const categoriesValues = [organizationId, `%${search}%`, skip, pageSize]
    const categoriesResult = await pool.query(categoriesQuery, categoriesValues)
    const categories = categoriesResult.rows

    // Get total count
    const countQuery = `
      SELECT COUNT(*) as total
      FROM product_categories
      WHERE "organizationId" = $1
      AND "name" ILIKE $2
    `
    const countValues = [organizationId, `%${search}%`]
    const countResult = await pool.query(countQuery, countValues)
    const totalCategories = Number(countResult.rows[0].total)

    return NextResponse.json({
      categories,
      totalPages: Math.ceil(totalCategories / pageSize),
      currentPage: page,
    }, { status: 200 })
  } catch (error) {
    console.error("[GET /api/product-categories] error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    // Check API key for public access
    const apiKey = req.headers.get("x-api-key")
    if (apiKey !== PUBLIC_API_KEY) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
    }

    // Check session (optional, depending on your public API requirements)
    const session = await auth.api.getSession({ headers: req.headers })
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const organizationId = session.session.activeOrganizationId
    if (!organizationId) {
      return NextResponse.json({ error: "No active organization" }, { status: 400 })
    }

    const body = await req.json()
    const validatedData = categorySchema.parse({
      ...body,
      organizationId,
    })

    // Generate slug if not provided
    const slug = validatedData.slug || slugify(validatedData.name)

    // Check if slug exists
    const slugCheckQuery = `
      SELECT id FROM product_categories
      WHERE "organizationId" = $1 AND "slug" = $2
    `
    const slugCheckValues = [organizationId, slug]
    const slugCheckResult = await pool.query(slugCheckQuery, slugCheckValues)
    if (slugCheckResult.rows.length > 0) {
      return NextResponse.json({ error: "Slug already exists" }, { status: 400 })
    }

    // Insert new category
    const categoryId = uuidv4()
    const insertQuery = `
      INSERT INTO product_categories("id", "name", "slug", "image", "order", "parentId", "organizationId")
      VALUES($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
    `
    const insertValues = [
      categoryId,
      validatedData.name,
      slug,
      validatedData.image ?? null,
      validatedData.order ?? 0,
      validatedData.parentId ?? null,
      organizationId,
    ]
    const insertResult = await pool.query(insertQuery, insertValues)
    const createdCategory = insertResult.rows[0]

    return NextResponse.json({ category: createdCategory }, { status: 200 })
  } catch (error) {
    console.error("[POST /api/product-categories] error:", error)
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.errors }, { status: 400 })
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}