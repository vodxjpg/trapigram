// src/app/api/warehouses/route.ts
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
    const { rows: warehouseRows } = await pool.query(
      `
      SELECT w.*, 
             ws.id        AS stock_id, 
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

    const warehousesMap = new Map<string, any>();
    for (const row of warehouseRows) {
      const warehouseId = row.id;
      if (!warehousesMap.has(warehouseId)) {
        const organizationId = String(row.organizationId).split(",");
        let countries: string[] = [];
        try {
          countries = JSON.parse(row.countries);
        } catch {
          countries = String(row.countries).split(",");
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
    // Frontend sends `organizationId` as an array of IDs
    const { name, organizationId, countries, stock } = await req.json();
    const organizationIds = Array.isArray(organizationId) ? organizationId : [];

    if (
      !name ||
      organizationIds.length === 0 ||
      !Array.isArray(countries) ||
      countries.length === 0
    ) {
      return NextResponse.json(
        { error: "Name, organizationId (array), and countries (array) are required" },
        { status: 400 }
      );
    }

    // Fetch tenantId
    const { rows: tenantRows } = await pool.query(
      `SELECT id FROM tenant WHERE "ownerUserId" = $1`,
      [userId]
    );
    if (tenantRows.length === 0) {
      return NextResponse.json({ error: "No tenant found for user" }, { status: 404 });
    }
    const tenantId = tenantRows[0].id;

    // Validate organization IDs exist
    const { rows: orgRows } = await pool.query(
      `SELECT id FROM organization WHERE id = ANY($1)`,
      [organizationIds]
    );
    const validOrgIds = orgRows.map(r => r.id);
    if (validOrgIds.length === 0) {
      return NextResponse.json({ error: "Invalid organizationId values" }, { status: 400 });
    }

    const countriesJson = JSON.stringify(countries);
    const created: any[] = [];

    // Insert one warehouse per valid organization
    for (const orgId of validOrgIds) {
      const { rows } = await pool.query(
        `
        INSERT INTO warehouse (
          id, "tenantId", "organizationId", name, countries
        ) VALUES (
          gen_random_uuid()::text, $1, $2, $3, $4::jsonb
        )
        RETURNING *
        `,
        [tenantId, orgId, name, countriesJson]
      );
      const warehouse = rows[0];
      created.push(warehouse);

      if (Array.isArray(stock) && stock.length > 0) {
        for (const entry of stock) {
          await pool.query(
            `
            INSERT INTO "warehouseStock" (
              id, "warehouseId", "productId", "variationId",
              country, quantity, "organizationId", "tenantId", createdAt, updatedAt
            ) VALUES (
              gen_random_uuid()::text, $1, $2, $3, $4, $5, $6, $7, NOW(), NOW()
            )
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
    }

    return NextResponse.json({ warehouses: created }, { status: 201 });
  } catch (error) {
    console.error("[POST /api/warehouses] error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
