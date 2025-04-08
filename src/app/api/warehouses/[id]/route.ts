import { NextRequest, NextResponse } from "next/server";
import { Pool } from "pg";
import { auth } from "@/lib/auth";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET as string;

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
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
    const id = params.id;
    const { name, organizationId, countries } = await req.json(); // Remove tenantId from frontend payload
    console.log("Received payload for PUT:", { name, organizationId, countries, id, userId });

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
      UPDATE warehouse
      SET "tenantId" = $1, "organizationId" = $2::jsonb, name = $3, countries = $4::jsonb, "updatedAt" = NOW()
      WHERE id = $5
      RETURNING *
      `,
      [tenantId, organizationIdJson, name, countriesJson, id]
    );

    if (rows.length === 0) {
      return NextResponse.json({ error: `Warehouse with ID ${id} not found` }, { status: 404 });
    }

    const warehouse = rows[0];
    return NextResponse.json({ warehouse }, { status: 200 });
  } catch (error) {
    console.error("[PUT /api/warehouses/[id]] error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
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
    const id = params.id;

    const { rowCount } = await pool.query("DELETE FROM warehouse WHERE id = $1", [id]);

    if (rowCount === 0) {
      return NextResponse.json({ error: `Warehouse with ID ${id} not found` }, { status: 404 });
    }

    return NextResponse.json({ message: "Warehouse deleted" }, { status: 200 });
  } catch (error) {
    console.error("[DELETE /api/warehouses/[id]] error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}