// File: src/app/api/organizations/countries/route.ts

import { NextRequest, NextResponse } from "next/server";
import { Pool } from "pg";
import { getContext } from "@/lib/context";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

export async function GET(req: NextRequest) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { organizationId } = ctx;

  try {
    // Query the organization table for the countries using the organizationId.
    const query = `
      SELECT countries
      FROM organization
      WHERE id = $1
    `;
    const result = await pool.query(query, [organizationId]);

    if (result.rows.length === 0) {
      return NextResponse.json({ error: "Organization not found" }, { status: 404 });
    }

    const countriesData = result.rows[0].countries;
    return NextResponse.json({ countries: countriesData }, { status: 200 });
  } catch (error: any) {
    console.error("[GET /api/organizations/countries] error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
