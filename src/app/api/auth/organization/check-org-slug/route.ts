// File: src/app/api/auth/organization/check-org-slug/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getContext } from "@/lib/context";
import { Pool } from "pg";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

export async function GET(req: NextRequest) {
  // 1. Central auth: service key, API key or session cookie
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;

  try {
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
    console.error("[GET /api/auth/organization/check-org-slug] error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
