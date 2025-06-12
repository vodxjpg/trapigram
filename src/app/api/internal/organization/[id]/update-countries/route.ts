// src/app/api/organizations/[identifier]/update-countries/route.ts
import { NextRequest, NextResponse } from "next/server";
import { Pool } from "pg";
import { getContext } from "@/lib/context";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

export async function POST(
  req: NextRequest,
  { params }: { params: { identifier: string } }
) {
  // 1) session-cookie auth & get org
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { organizationId: ctxOrg } = ctx;
  const orgId = params.identifier;
  if (ctxOrg !== orgId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // 2) parse and validate body
  const { countries } = await req.json();
  if (!Array.isArray(countries) || countries.some(c => typeof c !== 'string')) {
    return NextResponse.json(
      { error: "Countries must be an array of country codes" },
      { status: 400 }
    );
  }

  // 3) update database
  try {
    const result = await pool.query(
      `UPDATE organization
         SET countries = $1
       WHERE id = $2`,
      [JSON.stringify(countries), orgId]
    );
    if (result.rowCount === 0) {
      return NextResponse.json(
        { error: "Organization not found" },
        { status: 404 }
      );
    }
    return NextResponse.json(
      { message: "Countries updated successfully" },
      { status: 200 }
    );
  } catch (err) {
    console.error("[POST /api/organizations/:identifier/update-countries] error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
