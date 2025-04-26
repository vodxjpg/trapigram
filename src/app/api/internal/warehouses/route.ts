import { NextRequest, NextResponse } from "next/server";
import { Pool } from "pg";
import { auth } from "@/lib/auth";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

const INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET as string;

export async function POST(req: NextRequest) {
  try {
    const secret = req.headers.get("x-internal-secret");
    if (secret !== INTERNAL_API_SECRET) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    const session = await auth.api.getSession({ headers: req.headers });
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { organizationIds, warehouseName, countries, tenantId } = (await req.json()) as {
      organizationIds: string[];
      warehouseName: string;
      countries: string[];
      tenantId: string;
    };

    if (!organizationIds || organizationIds.length === 0) {
      return NextResponse.json(
        { error: "At least one organizationId is required" },
        { status: 400 }
      );
    }
    if (!warehouseName) {
      return NextResponse.json({ error: "No warehouseName provided" }, { status: 400 });
    }
    if (!countries || countries.length === 0) {
      return NextResponse.json({ error: "At least one country is required" }, { status: 400 });
    }
    if (!tenantId) {
      return NextResponse.json({ error: "tenantId is required" }, { status: 400 });
    }

    // Note: We no longer generate the ID here with nanoid(); it's handled in the query
    const organizationIdString = organizationIds.join(","); // Keeping as comma-separated string for now
    const text = `
      INSERT INTO warehouse("id", "tenantId", "organizationId", "name", "countries", "createdAt", "updatedAt")
      VALUES (gen_random_uuid()::text, $1, $2, $3, $4::jsonb, NOW(), NOW())
      RETURNING id, "tenantId", "organizationId", "name", "countries"
    `;
    const values = [tenantId, organizationIdString, warehouseName, JSON.stringify(countries)];
    const result = await pool.query(text, values);

    const createdWarehouse = result.rows[0];

    return NextResponse.json({ warehouse: createdWarehouse }, { status: 200 });
  } catch (error) {
    console.error("[POST /api/internal/warehouses] error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}