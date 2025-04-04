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

    // Was: const session = await auth()
    // Now:
    const session = await auth.api.getSession({ headers: req.headers })
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    // *** Key fix: session.session.activeOrganizationId
    const organizationId = session.session.activeOrganizationId
    if (!organizationId) {
      return NextResponse.json({ error: "No active organization" }, { status: 400 })
    }

    const category = await db
      .selectFrom("product_categories")
      .selectAll()
      .where("id", "=", id)
      .where("organizationId", "=", organizationId)
      .executeTakeFirst()

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

    const session = await auth.api.getSession({ headers: req.headers })
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    // *** Key fix:
    const organizationId = session.session.activeOrganizationId
    if (!organizationId) {
      return NextResponse.json({ error: "No active organization" }, { status: 400 })
    }

    const existingCategory = await db
      .selectFrom("product_categories")
      .selectAll()
      .where("id", "=", id)
      .where("organizationId", "=", organizationId)
      .executeTakeFirst()

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

    if (slug) {
      const slugExists = await db
        .selectFrom("product_categories")
        .selectAll()
        .where("organizationId", "=", organizationId)
        .where("slug", "=", slug)
        .where("id", "!=", id)
        .executeTakeFirst()

      if (slugExists) {
        return NextResponse.json({ error: "Slug already exists" }, { status: 400 })
      }
    }

    const [updatedCategory] = await db
      .updateTable("product_categories")
      .set({
        name: validatedData.name ?? existingCategory.name,
        slug: slug ?? existingCategory.slug,
        image: validatedData.image ?? existingCategory.image,
        order: validatedData.order ?? existingCategory.order,
        parentId: validatedData.parentId ?? existingCategory.parentId,
      })
      .where("id", "=", id)
      .returningAll()
      .execute()

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

    const session = await auth.api.getSession({ headers: req.headers })
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    // *** Key fix:
    const organizationId = session.session.activeOrganizationId
    if (!organizationId) {
      return NextResponse.json({ error: "No active organization" }, { status: 400 })
    }

    const existingCategory = await db
      .selectFrom("product_categories")
      .selectAll()
      .where("id", "=", id)
      .where("organizationId", "=", organizationId)
      .executeTakeFirst()

    if (!existingCategory) {
      return NextResponse.json({ error: "Category not found" }, { status: 404 })
    }

    await db
      .deleteFrom("product_categories")
      .where("id", "=", id)
      .execute()

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Error deleting category:", error)
    return NextResponse.json({ error: "Failed to delete category" }, { status: 500 })
  }
}
