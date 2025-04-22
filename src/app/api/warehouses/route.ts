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
    // Query warehouses and their stock
    const { rows: warehouseRows } = await pool.query(
      `
      SELECT w.*, 
             ws."id" AS stock_id, 
             ws."productId", 
             ws."variationId", 
             ws."country", 
             ws."quantity"
      FROM warehouse w
      LEFT JOIN "warehouseStock" ws ON w.id = ws."warehouseId"
      WHERE w."tenantId" IN (
        SELECT id FROM tenant WHERE "ownerUserId" = $1
      )
      `,
      [userId]
    );

    // Group stock data by warehouse
    const warehousesMap = new Map<string, any>();
    for (const row of warehouseRows) {
      const warehouseId = row.id;
      if (!warehousesMap.has(warehouseId)) {
        let organizationId: string[] = [];
        if (row.organizationId) {
          if (typeof row.organizationId === "string") {
            if (row.organizationId.startsWith("[")) {
              try {
                organizationId = JSON.parse(row.organizationId);
              } catch (e) {
                console.error(`Failed to parse organizationId: ${row.organizationId}`, e);
                organizationId = [];
              }
            } else {
              organizationId = row.organizationId.split(",");
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
                countries = [];
              }
            } else {
              countries = row.countries.split(",");
            }
          } else {
            countries = row.countries || [];
          }
        }

        warehousesMap.set(warehouseId, {
          id: row.id,
          tenantId: row.tenantId,
          organizationId,
          name: row.name,
          countries,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
          stock: [],
        });
      }

      // Add stock entry if present
      if (row.stock_id) {
        warehousesMap.get(warehouseId).stock.push({
          id: row.stock_id,
          productId: row.productId,
          variationId: row.variationId,
          country: row.country,
          quantity: row.quantity,
        });
      }
    }

    const warehouses = Array.from(warehousesMap.values());

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
    const { name, organizationId, countries, stock } = await req.json();
    console.log("Received payload:", { name, organizationId, countries, stock, userId });

    if (!name || !organizationId || !countries) {
      return NextResponse.json(
        { error: "Name, organizationId, and countries are required" },
        { status: 400 }
      );
    }

    // Validate stock if provided
    if (stock) {
      if (!Array.isArray(stock)) {
        return NextResponse.json({ error: "Stock must be an array" }, { status: 400 });
      }
      for (const entry of stock) {
        if (
          !entry.productId ||
          typeof entry.country !== "string" ||
          typeof entry.quantity !== "number" ||
          entry.quantity < 0 ||
          (entry.variationId && typeof entry.variationId !== "string")
        ) {
          return NextResponse.json(
            { error: "Invalid stock entry: must include productId, country, quantity, and optional variationId" },
            { status: 400 }
          );
        }
      }
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

    // Fetch organization to get organizationId for stock entries
    const { rows: orgRows } = await pool.query(
      `SELECT id FROM organization WHERE id = ANY($1)`,
      [organizationId]
    );
    if (orgRows.length === 0) {
      return NextResponse.json({ error: "Invalid organizationId" }, { status: 400 });
    }
    const orgId = orgRows[0].id;

    const organizationIdJson = JSON.stringify(organizationId);
    const countriesJson = JSON.stringify(countries);

    // Create warehouse
    const { rows } = await pool.query(
      `
      INSERT INTO warehouse (id, "tenantId", "organizationId", name, countries)
      VALUES (gen_random_uuid()::text, $1, $2::jsonb, $3, $4::jsonb)
      RETURNING *
      `,
      [tenantId, organizationIdJson, name, countriesJson]
    );

    const warehouse = rows[0];

    // Insert stock entries if provided
    if (stock && stock.length > 0) {
      for (const entry of stock) {
        await pool.query(
          `
          INSERT INTO "warehouseStock" (
            "id", "warehouseId", "productId", "variationId", "country", "quantity", 
            "organizationId", "tenantId", "createdAt", "updatedAt"
          )
          VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
          `,
          [
            warehouse.id,
            entry.productId,
            entry.variationId || null,
            entry.country,
            entry.quantity,
            orgId,
            tenantId,
          ]
        );
      }
    }

    return NextResponse.json({ warehouse }, { status: 201 });
  } catch (error) {
    console.error("[POST /api/warehouses] error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}