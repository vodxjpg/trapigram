// src/app/api/warehouses/[id]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { pgPool as pool } from "@/lib/db";;
import { auth } from "@/lib/auth";


const INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET as string;

export async function PUT(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const apiKey = req.headers.get("x-api-key");
  const internalSecret = req.headers.get("x-internal-secret");
  let userId: string;

  // Authenticate
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
          { error: "Unauthorized: API key or internal secret required" },
          { status: 403 }
        );
      }
      return NextResponse.json({ error: "Unauthorized session" }, { status: 401 });
    }
    userId = session.user.id;
  }

  try {
    const warehouseId = params.id;
    const { name, organizationId, countries, stock } = await req.json();

    // organizationId arrives as array; extract first element
    const orgIds = Array.isArray(organizationId) ? organizationId : [];
    if (orgIds.length === 0) {
      return NextResponse.json({ error: "organizationId array must have at least one ID" }, { status: 400 });
    }
    const orgId = orgIds[0];

    if (!name || !countries || !Array.isArray(countries) || countries.length === 0) {
      return NextResponse.json(
        { error: "Name and countries (non-empty array) are required" },
        { status: 400 }
      );
    }

    // Validate tenant
    const { rows: tenantRows } = await pool.query(
      `SELECT id FROM tenant WHERE "ownerUserId" = $1`,
      [userId]
    );
    if (tenantRows.length === 0) {
      return NextResponse.json({ error: "No tenant found for user" }, { status: 404 });
    }
    const tenantId = tenantRows[0].id;

    // Validate organization exists
    const { rows: orgRows } = await pool.query(
      `SELECT id FROM organization WHERE id = $1`,
      [orgId]
    );
    if (orgRows.length === 0) {
      return NextResponse.json({ error: "Invalid organizationId" }, { status: 400 });
    }

    const countriesJson = JSON.stringify(countries);

    // Update warehouse record
    const { rows } = await pool.query(
      `
      UPDATE warehouse
      SET
        "tenantId" = $1,
        "organizationId" = $2,
        name = $3,
        countries = $4::jsonb,
        "updatedAt" = NOW()
      WHERE id = $5
      RETURNING *
      `,
      [tenantId, orgId, name, countriesJson, warehouseId]
    );

    if (rows.length === 0) {
      return NextResponse.json({ error: `Warehouse ${warehouseId} not found` }, { status: 404 });
    }
    const warehouse = rows[0];

    // Replace stock if provided
    if (stock) {
      if (!Array.isArray(stock)) {
        return NextResponse.json({ error: "Stock must be an array" }, { status: 400 });
      }
      // Delete existing
      await pool.query(`DELETE FROM "warehouseStock" WHERE "warehouseId" = $1`, [warehouseId]);

      // Insert new entries
      for (const entry of stock) {
        await pool.query(
          `
          INSERT INTO "warehouseStock" (
            id, "warehouseId", "productId", "variationId",
            country, quantity, "organizationId", "tenantId", createdAt, updatedAt
          )
          VALUES (
            gen_random_uuid()::text, $1, $2, $3, $4, $5, $6, $7, NOW(), NOW()
          )
          `,
          [
            warehouseId,
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

    return NextResponse.json({ warehouse }, { status: 200 });
  } catch (error) {
    console.error("[PUT /api/warehouses/[id]] error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
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
          { error: "Unauthorized: Provide API key or internal secret" },
          { status: 403 }
        );
      }
      return NextResponse.json({ error: "Unauthorized session" }, { status: 401 });
    }
    userId = session.user.id;
  }

  try {
    const warehouseId = params.id;
    const { rowCount } = await pool.query("DELETE FROM warehouse WHERE id = $1", [warehouseId]);
    if (rowCount === 0) {
      return NextResponse.json({ error: `Warehouse ${warehouseId} not found` }, { status: 404 });
    }
    return NextResponse.json({ message: "Warehouse deleted" }, { status: 200 });
  } catch (error) {
    console.error("[DELETE /api/warehouses/[id]] error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
