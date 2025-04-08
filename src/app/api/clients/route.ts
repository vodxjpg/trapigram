// src/app/api/clients/route.ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Pool } from "pg";
import { auth } from "@/lib/auth";
import { v4 as uuidv4 } from "uuid";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});
const INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET as string;

const clientSchema = z.object({
  username: z.string().min(3, { message: "Username must be at least 3 characters." }),
  firstName: z.string().min(1, { message: "First name is required." }),
  lastName: z.string().min(1, { message: "Last name is required." }),
  email: z.string().email({ message: "Please enter a valid email address." }),
  phoneNumber: z.string().min(1, { message: "Phone number is required." }),
  referredBy: z.string().optional(),
});

export async function GET(req: NextRequest) {
  const apiKey = req.headers.get("x-api-key");
  const internalSecret = req.headers.get("x-internal-secret");
  let organizationId: string;

  const { searchParams } = new URL(req.url);
  const explicitOrgId = searchParams.get("organizationId"); // Allow passing organizationId in query

  if (apiKey) {
    const { valid, error, key } = await auth.api.verifyApiKey({ body: { key: apiKey } });
    if (!valid || !key) {
      return NextResponse.json({ error: error?.message || "Invalid API key" }, { status: 401 });
    }
    // For API key usage, require explicit organizationId in query params
    organizationId = explicitOrgId || "";
    if (!organizationId) {
      return NextResponse.json({ error: "Organization ID is required in query parameters" }, { status: 400 });
    }
  } else if (internalSecret === INTERNAL_API_SECRET) {
    const session = await auth.api.getSession({ headers: req.headers });
    if (!session) {
      return NextResponse.json({ error: "Unauthorized session" }, { status: 401 });
    }
    // For internal use, fall back to session's activeOrganizationId if not provided
    organizationId = explicitOrgId || session.session.activeOrganizationId;
    if (!organizationId) {
      return NextResponse.json({ error: "No active organization in session" }, { status: 400 });
    }
  } else {
    return NextResponse.json(
      { error: "Unauthorized: Provide either an API key or internal secret" },
      { status: 403 }
    );
  }

  const page = Number(searchParams.get("page")) || 1;
  const pageSize = Number(searchParams.get("pageSize")) || 10;
  const search = searchParams.get("search") || "";

  let countQuery = `
    SELECT COUNT(*) FROM clients
    WHERE "organizationId" = $1
  `;
  const countValues: any[] = [organizationId];
  if (search) {
    countQuery += ` AND (username ILIKE $2 OR "firstName" ILIKE $2 OR "lastName" ILIKE $2 OR email ILIKE $2)`;
    countValues.push(`%${search}%`);
  }

  let query = `
    SELECT id, "userId", "organizationId", username, "firstName", "lastName", "lastInteraction", email, "phoneNumber", "levelId", "referredBy", "createdAt", "updatedAt"
    FROM clients
    WHERE "organizationId" = $1
  `;
  const values: any[] = [organizationId];
  if (search) {
    query += ` AND (username ILIKE $2 OR "firstName" ILIKE $2 OR "lastName" ILIKE $2 OR email ILIKE $2)`;
    values.push(`%${search}%`);
  }
  query += ` ORDER BY "createdAt" DESC LIMIT $${values.length + 1} OFFSET $${values.length + 2}`;
  values.push(pageSize, (page - 1) * pageSize);

  try {
    const countResult = await pool.query(countQuery, countValues);
    const totalRows = Number(countResult.rows[0].count);
    const totalPages = Math.ceil(totalRows / pageSize);

    const result = await pool.query(query, values);
    const clients = result.rows;

    return NextResponse.json({
      clients,
      totalPages,
      currentPage: page,
    });
  } catch (error: any) {
    console.error("[GET /api/clients] error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const apiKey = req.headers.get("x-api-key");
  const internalSecret = req.headers.get("x-internal-secret");
  let organizationId: string;

  if (apiKey) {
    const { valid, error, key } = await auth.api.verifyApiKey({ body: { key: apiKey } });
    if (!valid || !key) {
      return NextResponse.json({ error: error?.message || "Invalid API key" }, { status: 401 });
    }
    const session = await auth.api.getSession({ headers: req.headers });
    organizationId = session?.session.activeOrganizationId || "";
    if (!organizationId) {
      return NextResponse.json({ error: "No active organization" }, { status: 400 });
    }
  } else if (internalSecret === INTERNAL_API_SECRET) {
    const session = await auth.api.getSession({ headers: req.headers });
    if (!session) {
      return NextResponse.json({ error: "Unauthorized session" }, { status: 401 });
    }
    organizationId = session.session.activeOrganizationId;
    if (!organizationId) {
      return NextResponse.json({ error: "No active organization" }, { status: 400 });
    }
  } else {
    return NextResponse.json(
      { error: "Unauthorized: Provide either an API key or internal secret" },
      { status: 403 }
    );
  }

  try {
    const body = await req.json();
    const parsedClient = clientSchema.parse(body);
    const { username, firstName, lastName, email, phoneNumber, referredBy } = parsedClient;
    const clientId = uuidv4();

    const insertQuery = `
      INSERT INTO clients(id, "organizationId", username, "firstName", "lastName", email, "phoneNumber", "referredBy", "createdAt", "updatedAt")
      VALUES($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())
      RETURNING *
    `;
    const values = [clientId, organizationId, username, firstName, lastName, email, phoneNumber, referredBy || null];

    const result = await pool.query(insertQuery, values);
    return NextResponse.json(result.rows[0], { status: 201 });
  } catch (error: any) {
    console.error("[POST /api/clients] error:", error);
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.errors }, { status: 400 });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}