import { NextRequest, NextResponse } from "next/server";
import { Pool } from "pg";
import { auth } from "@/lib/auth";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET as string;

export async function GET(req: NextRequest) {
  const apiKey = req.headers.get("x-api-key");
  const internalSecret = req.headers.get("x-internal-secret");
  let userId: string;

  if (apiKey) {
    const { valid, error, key } = await auth.api.verifyApiKey({ body: { key: apiKey } });
    if (!valid || !key) {
      return NextResponse.json({ error: error?.message || "Invalid API key" }, { status: 401 });
    }
    userId = key.userId;
  } else {
    const session = await auth.api.getSession({ headers: req.headers });
    if (!session) {
      if (internalSecret !== INTERNAL_API_SECRET) {
        return NextResponse.json(
          { error: "Unauthorized: Provide either an API key or internal secret" },
          { status: 403 }
        );
      }
      return NextResponse.json({ error: "Unauthorized session" }, { status: 401 });
    }
    userId = session.user.id;
  }

  try {
    const { rows } = await pool.query(
      `
      SELECT *
      FROM warehouse
      `,
      []
    );

    const warehouses = rows.map((row) => {
      let organizationId: string[] = [];
      if (row.organizationId) {
        if (typeof row.organizationId === "string") {
          if (row.organizationId.startsWith("[")) {
            try {
              organizationId = JSON.parse(row.organizationId);
            } catch (e) {
              console.error(`Failed to parse organizationId: ${row.organizationId}`, e);
              organizationId = []; // Fallback to empty array on error
            }
          } else {
            organizationId = row.organizationId.split(","); // Handle comma-separated strings
          }
        } else {
          organizationId = row.organizationId || [];
        }
      }

      let countries: string[] = [];
      if (row.countries) {
        if (typeof row.countries === "string") {
          if (row.countries.startsWith("[")) {
            try {
              countries = JSON.parse(row.countries);
            } catch (e) {
              console.error(`Failed to parse countries: ${row.countries}`, e);
              countries = []; // Fallback to empty array on error
            }
          } else {
            countries = row.countries.split(","); // Handle comma-separated strings
          }
        } else {
          countries = row.countries || [];
        }
      }

      return {
        id: row.id,
        tenantId: row.tenantId,
        organizationId,
        name: row.name,
        countries,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      };
    });

    return NextResponse.json({ warehouses }, { status: 200 });
  } catch (error) {
    console.error("[GET /api/warehouses] error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const apiKey = req.headers.get("x-api-key");
  const internalSecret = req.headers.get("x-internal-secret");
  let userId: string;

  if (apiKey) {
    const { valid, error, key } = await auth.api.verifyApiKey({ body: { key: apiKey } });
    if (!valid || !key) {
      return NextResponse.json({ error: error?.message || "Invalid API key" }, { status: 401 });
    }
    userId = key.userId;
  } else {
    const session = await auth.api.getSession({ headers: req.headers });
    if (!session) {
      if (internalSecret !== INTERNAL_API_SECRET) {
        return NextResponse.json(
          { error: "Unauthorized: Provide either an API key or internal secret" },
          { status: 403 }
        );
      }
      return NextResponse.json({ error: "Unauthorized session" }, { status: 401 });
    }
    userId = session.user.id;
  }

  try {
    const { name, organizationId, countries } = await req.json(); // Remove tenantId from frontend payload
    console.log("Received payload:", { name, organizationId, countries, userId });

    if (!name || !organizationId || !countries) {
      return NextResponse.json(
        { error: "Name, organizationId, and countries are required" },
        { status: 400 }
      );
    }

    // Fetch tenantId based on userId
    const { rows: tenantRows } = await pool.query(
      `SELECT id FROM tenant WHERE "ownerUserId" = $1`,
      [userId]
    );
    if (tenantRows.length === 0) {
      return NextResponse.json({ error: "No tenant found for user" }, { status: 404 });
    }
    const tenantId = tenantRows[0].id;

    const organizationIdJson = JSON.stringify(organizationId);
    const countriesJson = JSON.stringify(countries);

    const { rows } = await pool.query(
      `
      INSERT INTO warehouse (id, "tenantId", "organizationId", name, countries)
      VALUES (gen_random_uuid()::text, $1, $2::jsonb, $3, $4::jsonb)
      RETURNING *
      `,
      [tenantId, organizationIdJson, name, countriesJson]
    );

    const warehouse = rows[0];
    return NextResponse.json({ warehouse }, { status: 201 });
  } catch (error) {
    console.error("[POST /api/warehouses] error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}