import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Pool } from "pg";
import { auth } from "@/lib/auth";
import { v4 as uuidv4 } from "uuid";

/**
 * /api/clients
 * -------------
 * GET  — list clients for an organisation
 * POST — create a new client
 *
 * 🔑  Auth matrix
 * ┌──────────────┬─────────────────────────────────────────────────────────────┐
 * │ Header       │ How organisationId is resolved                             │
 * ├──────────────┼─────────────────────────────────────────────────────────────┤
 * │ x-api-key    │ *Must* come in the query-string ?organizationId=…           │
 * │ x-internal-… │ Pulled from the active session cookie (fallback to query)   │
 * └──────────────┴─────────────────────────────────────────────────────────────┘
 */

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET as string;

//──────────────────────────────────────────────────────────────────────────────
// Schema
//──────────────────────────────────────────────────────────────────────────────
const clientSchema = z.object({
  userId: z.string().min(1, { message: "userId is required." }),      // 👈 NEW
  username: z.string().min(3, { message: "Username must be at least 3 characters." }),
  firstName: z.string().min(1, { message: "First name is required." }),
  lastName: z.string().min(1, { message: "Last name is required." }),
  email: z.string().email({ message: "Please enter a valid email address." }),
  phoneNumber: z.string().min(1, { message: "Phone number is required." }),
  referredBy: z.string().optional().nullable(),
  country: z.string().optional().nullable(),
});

//──────────────────────────────────────────────────────────────────────────────
// Helpers
//──────────────────────────────────────────────────────────────────────────────
function missingOrgResponse() {
  return NextResponse.json(
    { error: "Organization ID is required in query parameters" },
    { status: 400 },
  );
}

//──────────────────────────────────────────────────────────────────────────────
// GET /api/clients
//──────────────────────────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const apiKey = req.headers.get("x-api-key");
  const internalSecret = req.headers.get("x-internal-secret");

  // Extract query parameters once
  const { searchParams } = new URL(req.url);
  const explicitOrgId = searchParams.get("organizationId");

  let organizationId: string;

  if (apiKey) {
    const { valid, error } = await auth.api.verifyApiKey({ body: { key: apiKey } });
    if (!valid) {
      return NextResponse.json({ error: error?.message || "Invalid API key" }, { status: 401 });
    }
    organizationId = explicitOrgId || "";
    if (!organizationId) return missingOrgResponse();
  } else if (internalSecret === INTERNAL_API_SECRET) {
    const session = await auth.api.getSession({ headers: req.headers });
    if (!session) return NextResponse.json({ error: "Unauthorized session" }, { status: 401 });
    organizationId = explicitOrgId || session.session.activeOrganizationId;
    if (!organizationId) {
      return NextResponse.json({ error: "No active organization in session" }, { status: 400 });
    }
  } else {
    return NextResponse.json(
      { error: "Unauthorized: Provide either an API key or internal secret" },
      { status: 403 },
    );
  }

  // Pagination & search
  const page = Number(searchParams.get("page")) || 1;
  const pageSize = Number(searchParams.get("pageSize")) || 10;
  const search = searchParams.get("search") || "";

  let countQuery = `SELECT COUNT(*) FROM clients WHERE "organizationId" = $1`;
  const countValues: any[] = [organizationId];
  if (search) {
    countQuery += ` AND (username ILIKE $2 OR "firstName" ILIKE $2 OR "lastName" ILIKE $2 OR email ILIKE $2)`;
    countValues.push(`%${search}%`);
  }

  let query = `
      SELECT id, "userId", "organizationId", username, "firstName", "lastName", "lastInteraction",
             email, "phoneNumber", "levelId", "referredBy", country, "createdAt", "updatedAt"
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
    return NextResponse.json({ clients: result.rows, totalPages, currentPage: page });
  } catch (error) {
    console.error("[GET /api/clients] error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

//──────────────────────────────────────────────────────────────────────────────
// POST /api/clients
//──────────────────────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const apiKey = req.headers.get("x-api-key");
  const internalSecret = req.headers.get("x-internal-secret");

  // Extract query parameters once
  const { searchParams } = new URL(req.url);
  const explicitOrgId = searchParams.get("organizationId");

  let organizationId: string;

  if (apiKey) {
    const { valid, error, key } = await auth.api.verifyApiKey({ body: { key: apiKey } });
    if (!valid || !key) {
      return NextResponse.json({ error: error?.message || "Invalid API key" }, { status: 401 });
    }
    // 👉 Use query param first; optionally fall back to information stored on the key
    organizationId = explicitOrgId || (key as any).organizationId || "";
    if (!organizationId) return missingOrgResponse();
  } else if (internalSecret === INTERNAL_API_SECRET) {
    const session = await auth.api.getSession({ headers: req.headers });
    if (!session) return NextResponse.json({ error: "Unauthorized session" }, { status: 401 });
    organizationId = explicitOrgId || session.session.activeOrganizationId;
    if (!organizationId) {
      return NextResponse.json({ error: "No active organization in session" }, { status: 400 });
    }
  } else {
    return NextResponse.json(
      { error: "Unauthorized: Provide either an API key or internal secret" },
      { status: 403 },
    );
  }

  //────────────────── insert client ──────────────────
  try {
    const body = await req.json();
    const parsedClient = clientSchema.parse(body);

    const clientId = uuidv4();
    const {
      userId,              // 👈 NEW
      username,
      firstName,
      lastName,
      email,
      phoneNumber,
      referredBy,
      country,
    } = parsedClient;

    const insertQuery = `
      INSERT INTO clients(
        id,
        "organizationId",
        "userId",          -- 👈 NEW
        username,
        "firstName",
        "lastName",
        email,
        "phoneNumber",
        "referredBy",
        country,
        "createdAt",
        "updatedAt"
      )
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW(),NOW())
      RETURNING *
    `;
    const values = [
      clientId,
      organizationId,
      userId,          // 👈 position matches $3 above
      username,
      firstName,
      lastName,
      email,
      phoneNumber,
      referredBy || null,
      country || null,
    ];

    const { rows } = await pool.query(insertQuery, values);
    return NextResponse.json(rows[0], { status: 201 });
  } catch (error: any) {
    console.error("[POST /api/clients] error:", error);
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.errors }, { status: 400 });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
