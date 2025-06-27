// /home/zodx/Desktop/Trapyfy/src/app/api/internal/organization/[id]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { pgPool as pool } from "@/lib/db";;
import { auth } from "@/lib/auth";

// nothingconst INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET as string;

export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const secret = req.headers.get("x-internal-secret");
    if (secret !== INTERNAL_API_SECRET) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }
    const session = await auth.api.getSession({ headers: req.headers });
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const { id } = await context.params;
    if (!id) {
      return NextResponse.json({ error: "No organization ID provided" }, { status: 400 });
    }
    const { rows: organizations } = await pool.query(
      `SELECT o.id, o.name, o.slug, o.logo, o.countries, o.metadata, o."encryptedSecret"
       FROM organization o
       JOIN member m ON o.id = m."organizationId"
       WHERE o.id = $1 AND m."userId" = $2`,
      [id, session.user.id]
    );
    if (organizations.length === 0) {
      return NextResponse.json({ error: "Organization not found or access denied" }, { status: 404 });
    }
    const org = organizations[0];
    return NextResponse.json({ organization: org }, { status: 200 });
  } catch (error) {
    console.error("[GET /api/internal/organization/[id]] error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}