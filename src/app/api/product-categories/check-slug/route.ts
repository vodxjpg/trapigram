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

    const session = await auth.api.getSession({ headers: req.headers });
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Check if the session has an active organization
    const organizationId = session.session.activeOrganizationId;
    console.log("Has active organization:", !!organizationId);

    if (!organizationId) {
      console.log("No active organization, redirecting to /select-organization");
      return NextResponse.json({ redirect: "/select-organization" });
    }

    // Build whereClause with the active organization ID and slug
    const whereClause: any = {
      organizationId,
      slug,
    }

    // Exclude current category if editing
    if (categoryId) {
      whereClause.id = {
        not: Number.parseInt(categoryId),
      }
    }

    // Use the correct table name from your DB interface: product_categories
    const existingCategory = await db.productCategories.findFirst({
      where: whereClause,
    })

    return NextResponse.json({ exists: !!existingCategory })
  } catch (error) {
    console.error("Error checking slug:", error)
    return NextResponse.json({ error: "Failed to check slug" }, { status: 500 })
  }
}
