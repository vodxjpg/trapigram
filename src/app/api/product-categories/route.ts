import { type NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { auth } from "@/lib/auth"
import { db } from "@/lib/db"
import { slugify } from "@/lib/utils"
import { v4 as uuidv4 } from "uuid";

// Schema for category validation
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
    const { searchParams } = new URL(req.url)
    const search = searchParams.get("search") || ""
    const page = Number.parseInt(searchParams.get("page") || "1")
    const pageSize = Number.parseInt(searchParams.get("pageSize") || "10")
    const skip = (page - 1) * pageSize

    // COMMENTED OUT the old way:
    // const session = await auth()
    // if (!session?.user) {
    //   return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    // }

    // We get the session from better-auth the same way you do in check-slug:
    const session = await auth.api.getSession({ headers: req.headers })
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    // *** IMPORTANT FIX HERE:
    // Was: const organizationId = session.user.activeOrganizationId
    // Now: The logs show the activeOrganizationId is on session.session
    const organizationId = session.session.activeOrganizationId
    if (!organizationId) {
      return NextResponse.json({ error: "No active organization" }, { status: 400 })
    }

    // Get categories with product count (Kysely code):
    //   If your actual column is "organizationId" in Postgres, use that exactly.
    const categories = await db
      .selectFrom("product_categories")
      .selectAll()
      .where("organizationId", "=", organizationId)
      .where("name", "ilike", `%${search}%`) // case-insensitive
      .orderBy("order", "asc")
      .offset(skip)
      .limit(pageSize)
      .execute()

    // Get total row count
    const totalRow = await db
      .selectFrom("product_categories")
      .select(db.fn.countAll().as("count"))
      .where("organizationId", "=", organizationId)
      .where("name", "ilike", `%${search}%`)
      .executeTakeFirst()
    const totalCategories = Number(totalRow?.count ?? 0)

    return NextResponse.json({
      categories,
      totalPages: Math.ceil(totalCategories / pageSize),
      currentPage: page,
    })
  } catch (error) {
    console.error("Error fetching categories:", error)
    return NextResponse.json({ error: "Failed to fetch categories" }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    // COMMENTED OUT the old way:
    // const session = await auth()
    // if (!session?.user) {
    //   return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    // }

    const session = await auth.api.getSession({ headers: req.headers })
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    // *** IMPORTANT FIX:
    // Was: const organizationId = session.user.activeOrganizationId
    // Now: session.session.activeOrganizationId
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
    const existingCategory = await db
      .selectFrom("product_categories")
      .selectAll()
      .where("organizationId", "=", organizationId)
      .where("slug", "=", slug)
      .executeTakeFirst()

    if (existingCategory) {
      return NextResponse.json({ error: "Slug already exists" }, { status: 400 })
    }

    // Insert new category
    const [category] = await db
      .insertInto("product_categories")
      .values({
        id: uuidv4(),
        name: validatedData.name,
        slug,
        image: validatedData.image ?? null,
        order: validatedData.order ?? 0,
        parentId: validatedData.parentId ?? null,
        organizationId,
      })
      .returningAll()
      .execute()

    return NextResponse.json(category)
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.errors }, { status: 400 })
    }
    console.error("Error creating category:", error)
    return NextResponse.json({ error: "Failed to create category" }, { status: 500 })
  }
}
