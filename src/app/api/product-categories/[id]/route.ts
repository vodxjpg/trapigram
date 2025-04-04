import { type NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { auth } from "@/lib/auth"
import { db } from "@/lib/db"
import { slugify } from "@/lib/utils"

// Schema for category validation
const categoryUpdateSchema = z.object({
  name: z.string().min(1, "Name is required").optional(),
  slug: z.string().optional(),
  image: z.string().nullable().optional(),
  order: z.number().optional(),
  parentId: z.number().nullable().optional(),
})

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const id = Number.parseInt(params.id)

    const session = await auth()
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const organizationId = session.user.activeOrganizationId
    if (!organizationId) {
      return NextResponse.json({ error: "No active organization" }, { status: 400 })
    }

    const category = await db.productCategory.findFirst({
      where: {
        id,
        organizationId,
      },
      include: {
        _count: {
          select: {
            products: true,
          },
        },
        children: true,
        parent: true,
      },
    })

    if (!category) {
      return NextResponse.json({ error: "Category not found" }, { status: 404 })
    }

    return NextResponse.json(category)
  } catch (error) {
    console.error("Error fetching category:", error)
    return NextResponse.json({ error: "Failed to fetch category" }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const id = Number.parseInt(params.id)

    const session = await auth()
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const organizationId = session.user.activeOrganizationId
    if (!organizationId) {
      return NextResponse.json({ error: "No active organization" }, { status: 400 })
    }

    // Check if category exists and belongs to the organization
    const existingCategory = await db.productCategory.findFirst({
      where: {
        id,
        organizationId,
      },
    })

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

    // Check if slug exists for this organization (excluding current category)
    if (slug) {
      const slugExists = await db.productCategory.findFirst({
        where: {
          organizationId,
          slug,
          id: {
            not: id,
          },
        },
      })

      if (slugExists) {
        return NextResponse.json({ error: "Slug already exists" }, { status: 400 })
      }
    }

    const updatedCategory = await db.productCategory.update({
      where: {
        id,
      },
      data: {
        ...validatedData,
        slug,
      },
    })

    return NextResponse.json(updatedCategory)
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.errors }, { status: 400 })
    }
    console.error("Error updating category:", error)
    return NextResponse.json({ error: "Failed to update category" }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const id = Number.parseInt(params.id)

    const session = await auth()
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const organizationId = session.user.activeOrganizationId
    if (!organizationId) {
      return NextResponse.json({ error: "No active organization" }, { status: 400 })
    }

    // Check if category exists and belongs to the organization
    const existingCategory = await db.productCategory.findFirst({
      where: {
        id,
        organizationId,
      },
    })

    if (!existingCategory) {
      return NextResponse.json({ error: "Category not found" }, { status: 404 })
    }

    // Delete category
    await db.productCategory.delete({
      where: {
        id,
      },
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Error deleting category:", error)
    return NextResponse.json({ error: "Failed to delete category" }, { status: 500 })
  }
}

