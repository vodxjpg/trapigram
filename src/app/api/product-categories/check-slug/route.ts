import { type NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { db } from "@/lib/db"

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const slug = searchParams.get("slug")
    const categoryId = searchParams.get("categoryId")

    if (!slug) {
      return NextResponse.json({ error: "Slug is required" }, { status: 400 })
    }

    const session = await auth.api.getSession({ headers: req.headers })
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    // *** Keep the same approach you had, referencing session.session.activeOrganizationId
    const organizationId = session.session.activeOrganizationId
    console.log("Has active organization:", !!organizationId)

    if (!organizationId) {
      console.log("No active organization, redirecting to /select-organization")
      return NextResponse.json({ redirect: "/select-organization" })
    }

    const parsedCategoryId = categoryId ? Number.parseInt(categoryId) : null

    let query = db
      .selectFrom("product_categories")
      .selectAll()
      .where("organizationId", "=", organizationId)
      .where("slug", "=", slug)

    if (parsedCategoryId) {
      query = query.where("id", "!=", parsedCategoryId)
    }

    const existingCategory = await query.executeTakeFirst()

    return NextResponse.json({ exists: !!existingCategory })
  } catch (error) {
    console.error("Error checking slug:", error)
    return NextResponse.json({ error: "Failed to check slug" }, { status: 500 })
  }
}
