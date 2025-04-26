import { NextRequest, NextResponse } from "next/server";
import { Pool } from "pg";
import { auth } from "@/lib/auth";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

const INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET as string;

export async function GET(req: NextRequest) {
  try {
    // 1) Check secret
    const secret = req.headers.get("x-internal-secret");
    if (secret !== INTERNAL_API_SECRET) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    // 2) Check session
    const session = await auth.api.getSession({ headers: req.headers });
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // 3) Get slug from query
    const { searchParams } = new URL(req.url);
    const slug = searchParams.get("slug");
    if (!slug) {
      return NextResponse.json({ error: "No slug provided" }, { status: 400 });
    }

    // 4) DB check
    // We'll see if any row in "organization" has the same slug
    const result = await pool.query(
      `SELECT 1 FROM organization WHERE slug=$1 LIMIT 1`,
      [slug]
    );
    if (result.rowCount > 0) {
      // Slug is taken
      return NextResponse.json({ available: false }, { status: 200 });
    } else {
      // Slug is free
      return NextResponse.json({ available: true }, { status: 200 });
    }
  } catch (error) {
    console.error("[GET /api/internal/organization/check-org-slug] error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
