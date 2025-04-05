// /home/zodx/Desktop/trapigram/src/app/api/product-categories/[id]/route.ts

import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { Pool } from "pg"
import { auth } from "@/lib/auth"
import { slugify } from "@/lib/utils"

// Initialize database connection (matching internal endpoint style)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
})

// API key for public endpoints (assuming public; adjust if internal)
const PUBLIC_API_KEY = process.env.PUBLIC_API_KEY as string

// Schema for category validation (unchanged)
const categoryUpdateSchema = z.object({
  name: z.string().min(1, "Name is required").optional(),
  slug: z.string().optional(),
  image: z.string().nullable().optional(),
  order: z.number().optional(),
  parentId: z.number().nullable().optional(),
})

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    // Check API key for public access
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
      return NextResponse.json({ error: "No active organization" }, { status: 400 })
    }

    const id = Number.parseInt(params.id)

    // Query category
    const queryText = `
      SELECT * FROM product_categories
      WHERE "id" = $1 AND "organizationId" = $2
    `
    const queryValues = [id, organizationId]
    const result = await pool.query(queryText, queryValues)
    const category = result.rows[0]

    if (!category) {
      return NextResponse.json({ error: "Category not found" }, { status: 404 })
    }

    return NextResponse.json({ category }, { status: 200 })
  } catch (error) {
    console.error("[GET /api/product-categories/[id]] error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    // Check API key for public access
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
      return NextResponse.json({ error: "No active organization" }, { status: 400 })
    }

    const id = Number.parseInt(params.id)

    // Check if category exists
    const existingQuery = `
      SELECT * FROM product_categories
      WHERE "id" = $1 AND "organizationId" = $2
    `
    const existingValues = [id, organizationId]
    const existingResult = await pool.query(existingQuery, existingValues)
    const existingCategory = existingResult.rows[0]

    if (!existingCategory) {
      return NextResponse.json({ error: "Category not found" }, { status: 404 })
    }

    const body = await req.json()
    const validatedData = categoryUpdateSchema.parse(body)

    // Generate slug if name is updated and slug is not provided
    let slug = validatedData.slug
    if (validatedData.name && !validatedData.slug) {
      slug = slugify(validatedData.name)
    }

    // Check if slug exists (if provided)
    if (slug) {
      const slugCheckQuery = `
        SELECT id FROM product_categories
        WHERE "organizationId" = $1 AND "slug" = $2 AND "id" != $3
      `
      const slugCheckValues = [organizationId, slug, id]
      const slugCheckResult = await pool.query(slugCheckQuery, slugCheckValues)
      if (slugCheckResult.rows.length > 0) {
        return NextResponse.json({ error: "Slug already exists" }, { status: 400 })
      }
    }

    // Update category
    const updateQuery = `
      UPDATE product_categories
      SET "name" = $1, "slug" = $2, "image" = $3, "order" = $4, "parentId" = $5
      WHERE "id" = $6 AND "organizationId" = $7
      RETURNING *
    `
    const updateValues = [
      validatedData.name ?? existingCategory.name,
      slug ?? existingCategory.slug,
      validatedData.image ?? existingCategory.image,
      validatedData.order ?? existingCategory.order,
      validatedData.parentId ?? existingCategory.parentId,
      id,
      organizationId,
    ]
    const updateResult = await pool.query(updateQuery, updateValues)
    const updatedCategory = updateResult.rows[0]

    return NextResponse.json({ category: updatedCategory }, { status: 200 })
  } catch (error) {
    console.error("[PATCH /api/product-categories/[id]] error:", error)
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.errors }, { status: 400 })
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    // Check API key for public access
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
      return NextResponse.json({ error: "No active organization" }, { status: 400 })
    }

    const id = Number.parseInt(params.id)

    // Check if category exists
    const existingQuery = `
      SELECT id FROM product_categories
      WHERE "id" = $1 AND "organizationId" = $2
    `
    const existingValues = [id, organizationId]
    const existingResult = await pool.query(existingQuery, existingValues)
    if (existingResult.rows.length === 0) {
      return NextResponse.json({ error: "Category not found" }, { status: 404 })
    }

    // Delete category
    const deleteQuery = `
      DELETE FROM product_categories
      WHERE "id" = $1 AND "organizationId" = $2
    `
    const deleteValues = [id, organizationId]
    await pool.query(deleteQuery, deleteValues)

    return NextResponse.json({ success: true }, { status: 200 })
  } catch (error) {
    console.error("[DELETE /api/product-categories/[id]] error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}