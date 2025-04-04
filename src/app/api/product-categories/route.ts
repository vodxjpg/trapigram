import { type NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { auth } from "@/lib/auth"
import { db } from "@/lib/db"
import { slugify } from "@/lib/utils"

// Schema for category validation
const categorySchema = z.object({
  name: z.string().min(1, "Name is required"),
  slug: z.string().optional(),
  image: z.string().nullable().optional(),
  order: z.number().default(0),
  parentId: z.number().nullable().optional(),
  organizationId: z.number(),
})

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const search = searchParams.get("search") || ""
    const page = Number.parseInt(searchParams.get("page") || "1")
    const pageSize = Number.parseInt(searchParams.get("pageSize") || "10")
    const skip = (page - 1) * pageSize

    const session = await auth()
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const organizationId = session.user.activeOrganizationId
    if (!organizationId) {
      return NextResponse.json({ error: "No active organization" }, { status: 400 })
    }

    // Get categories with product count
    const categories = await db.productCategory.findMany({
      where: {
        organizationId,
        name: {
          contains: search,
          mode: "insensitive",
        },
      },
      include: {
        _count: {
          select: {
            products: true,
          },
        },
        children: true,
      },
      orderBy: {
        order: "asc",
      },
      skip,
      take: pageSize,
    })

    const totalCategories = await db.productCategory.count({
      where: {
        organizationId,
        name: {
          contains: search,
          mode: "insensitive",
        },
      },
    })

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
    const session = await auth()
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const organizationId = session.user.activeOrganizationId
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

    // Check if slug exists for this organization
    const existingCategory = await db.productCategory.findFirst({
      where: {
        organizationId,
        slug,
      },
    })

    if (existingCategory) {
      return NextResponse.json({ error: "Slug already exists" }, { status: 400 })
    }

    const category = await db.productCategory.create({
      data: {
        ...validatedData,
        slug,
      },
    })

    return NextResponse.json(category)
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.errors }, { status: 400 })
    }
    console.error("Error creating category:", error)
    return NextResponse.json({ error: "Failed to create category" }, { status: 500 })
  }
}

