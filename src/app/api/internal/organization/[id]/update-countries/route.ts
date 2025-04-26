// /home/zodx/Desktop/trapigram/src/app/api/internal/organization/[id]/update-countries/route.ts
import { NextRequest, NextResponse } from "next/server";
import { Pool } from "pg";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});
const INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET as string;

export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const secret = req.headers.get("x-internal-secret");
    if (secret !== INTERNAL_API_SECRET) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    const { id } = await context.params;
    if (!id) {
      return NextResponse.json({ error: "No organization ID provided" }, { status: 400 });
    }

    const { countries } = await req.json();
    if (!countries) {
      return NextResponse.json({ error: "Countries data is required" }, { status: 400 });
    }

    const { rowCount } = await pool.query(
      `UPDATE organization SET countries = $1 WHERE id = $2`,
      [countries, id]
    );

    if (rowCount === 0) {
      return NextResponse.json({ error: "Organization not found" }, { status: 404 });
    }

    return NextResponse.json({ message: "Countries updated successfully" }, { status: 200 });
  } catch (error) {
    console.error("[POST /api/internal/organization/[id]/update-countries] error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}