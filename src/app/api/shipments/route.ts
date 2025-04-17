import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Pool } from "pg";
import { auth } from "@/lib/auth";
import { v4 as uuidv4 } from "uuid";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

const INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET as string;

// Shipment schema definition.
// Note: The "countries" field is expected to be provided as an array,
// and it will be stringified before inserting into the database.

const costGroupSchema = z.object({
  minOrderCost: z.coerce
    .number()
    .min(0, "Minimum order cost must be 0 or greater"),
  maxOrderCost: z.coerce
    .number()
    .min(0, "Maximum order cost must be 0 or greater"),
  shipmentCost: z.coerce
    .number()
    .min(0, "Shipment cost must be 0 or greater"),
});

const shipmentSchema = z.object({
  title: z.string().min(1, { message: "Title is required." }),
  description: z.string().min(1, { message: "Description is required." }),
  costs: z.array(costGroupSchema).optional(),
  countries: z.array(z.string()).min(1, { message: "At least one country is required." }),
  organizationId: z.string().min(1, { message: "Organization is required." }),
});

export async function GET(req: NextRequest) {
  const apiKey = req.headers.get("x-api-key");
  const internalSecret = req.headers.get("x-internal-secret");
  let organizationId: string;

  const { searchParams } = new URL(req.url);
  const explicitOrgId = searchParams.get("organizationId");

  // Case 1: Check for session (UI requests)
  const session = await auth.api.getSession({ headers: req.headers });
  if (session) {
    organizationId = explicitOrgId || session.session.activeOrganizationId;
    if (!organizationId) {
      return NextResponse.json({ error: "No active organization in session" }, { status: 400 });
    }
  }
  // Case 2: External API request with API key
  else if (apiKey) {
    const { valid, error, key } = await auth.api.verifyApiKey({ body: { key: apiKey } });
    if (!valid || !key) {
      return NextResponse.json({ error: error?.message || "Invalid API key" }, { status: 401 });
    }
    organizationId = explicitOrgId || "";
    if (!organizationId) {
      return NextResponse.json({ error: "Organization ID is required in query parameters" }, { status: 400 });
    }
  }
  // Case 3: Internal request with secret
  else if (internalSecret === INTERNAL_API_SECRET) {
    const internalSession = await auth.api.getSession({ headers: req.headers });
    if (!internalSession) {
      return NextResponse.json({ error: "Unauthorized session" }, { status: 401 });
    }
    organizationId = explicitOrgId || internalSession.session.activeOrganizationId;
    if (!organizationId) {
      return NextResponse.json({ error: "No active organization in session" }, { status: 400 });
    }
  } else {
    return NextResponse.json(
      { error: "Unauthorized: Provide a valid session, API key, or internal secret" },
      { status: 403 }
    );
  }

  const page = Number(searchParams.get("page")) || 1;
  const pageSize = Number(searchParams.get("pageSize")) || 10;
  const search = searchParams.get("search") || "";

  // Build a count query for pagination.
  let countQuery = `
    SELECT COUNT(*) FROM shipments
    WHERE "organizationId" = $1
  `;
  const countValues: any[] = [organizationId];
  if (search) {
    countQuery += ` AND (title ILIKE $2 OR description ILIKE $2)`;
    countValues.push(`%${search}%`);
  }

  // Build the main query.
  let query = `
    SELECT id, "organizationId", title, description, costs, countries, "createdAt", "updatedAt"
    FROM shipments
    WHERE "organizationId" = $1
  `;
  const values: any[] = [organizationId];
  if (search) {
    query += ` AND (title ILIKE $2 OR description ILIKE $2)`;
    values.push(`%${search}%`);
  }
  query += ` ORDER BY "createdAt" DESC LIMIT $${values.length + 1} OFFSET $${values.length + 2}`;
  values.push(pageSize, (page - 1) * pageSize);

  try {
    const countResult = await pool.query(countQuery, countValues);
    const totalRows = Number(countResult.rows[0].count);
    const totalPages = Math.ceil(totalRows / pageSize);

    const result = await pool.query(query, values);

    const shipments = result.rows;
    // Parse the countries field for each shipment.
    shipments.forEach((shipment) => {
      shipment.countries = JSON.parse(shipment.countries);
      shipment.costs = JSON.parse(shipment.costs)
    });

    return NextResponse.json({
      shipments,
      totalPages,
      currentPage: page,
    });
  } catch (error: any) {
    console.error("[GET /api/shipments] error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const apiKey = req.headers.get("x-api-key");
  const internalSecret = req.headers.get("x-internal-secret");
  let organizationId: string;

  const { searchParams } = new URL(req.url);
  const explicitOrgId = searchParams.get("organizationId");

  // Case 1: Check for session (UI requests)
  const session = await auth.api.getSession({ headers: req.headers });
  if (session) {
    organizationId = explicitOrgId || session.session.activeOrganizationId;
    if (!organizationId) {
      return NextResponse.json({ error: "No active organization in session" }, { status: 400 });
    }
  }
  // Case 2: External API request with API key
  else if (apiKey) {
    const { valid, error, key } = await auth.api.verifyApiKey({ body: { key: apiKey } });
    if (!valid || !key) {
      return NextResponse.json({ error: error?.message || "Invalid API key" }, { status: 401 });
    }
    organizationId = explicitOrgId || "";
    if (!organizationId) {
      return NextResponse.json({ error: "Organization ID is required in query parameters" }, { status: 400 });
    }
  }
  // Case 3: Internal request with secret
  else if (internalSecret === INTERNAL_API_SECRET) {
    const internalSession = await auth.api.getSession({ headers: req.headers });
    if (!internalSession) {
      return NextResponse.json({ error: "Unauthorized session" }, { status: 401 });
    }
    organizationId = explicitOrgId || internalSession.session.activeOrganizationId;
    if (!organizationId) {
      return NextResponse.json({ error: "No active organization in session" }, { status: 400 });
    }
  } else {
    return NextResponse.json({ error: "Unauthorized: Provide a valid session, API key, or internal secret" }, { status: 403 });
  }

  try {
    const body = await req.json();
    body.countries = JSON.parse(body.countries)
    body.costs = JSON.parse(body.costs)
    const parsedShipment = shipmentSchema.parse({ ...body, organizationId });
    const { title, description, costs, countries } = parsedShipment;
    const shipmentId = uuidv4();

    const insertQuery = `
      INSERT INTO shipments(id, "organizationId", title, description, costs, countries, "createdAt", "updatedAt")
      VALUES($1, $2, $3, $4, $5, $6, NOW(), NOW())
      RETURNING *
    `;
    const values = [
      shipmentId,
      organizationId,
      title,
      description,
      JSON.stringify(costs),
      JSON.stringify(countries),
    ];

    const result = await pool.query(insertQuery, values);
    const shipment = result.rows[0];
    return NextResponse.json(shipment, { status: 201 });
  } catch (error: any) {
    console.error("[POST /api/shipments] error:", error);
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.errors }, { status: 400 });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
