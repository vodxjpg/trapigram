// File: src/app/api/internal/organization/check-org-slug/route.ts
import { NextRequest, NextResponse } from "next/server";
import { pgPool as pool } from "@/lib/db";;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// Make sure you’ve set this in your env: INTERNAL_API_SECRET
const INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET;

export async function GET(req: NextRequest) {
  try {
    // 1. Internal secret check
    const secret = req.headers.get("x-internal-secret");
    if (secret !== INTERNAL_API_SECRET) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    // 2. Extract slug
    const { searchParams } = new URL(req.url);
    const slug = searchParams.get("slug");
    if (!slug) {
      return NextResponse.json({ error: "No slug provided" }, { status: 400 });
    }

    // 3. DB check
    const result = await pool.query(
      `SELECT 1 FROM organization WHERE slug = $1 LIMIT 1`,
      [slug]
    );

    return NextResponse.json(
      { available: result.rowCount === 0 },
      { status: 200 }
    );
  } catch (error) {
    console.error(
      "[GET /api/internal/organization/check-org-slug] error:",
      error
    );
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
