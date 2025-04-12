import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Pool } from "pg";
import { auth } from "@/lib/auth";
import { v4 as uuidv4 } from "uuid";

// Create a new PostgreSQL connection pool.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// Read the internal API secret from environment variables.
const INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET as string;

// -------------------------------------------------------------------
// Define the announcement schema using Zod for input validation.
// Fields: id, title, content, expirationDate, countries, status, sent
// Note: expirationDate is expected as an ISO date string (or null),
// and countries is a string (you can adjust this if it should be an array).
// -------------------------------------------------------------------
const announcementSchema = z.object({
  title: z.string().min(1, { message: "Title is required." }),
  content: z.string().min(1, { message: "Content is required." }),
  expirationDate: z.string().nullable().optional(),
  countries: z.string().min(1, { message: "Countries is required." }),
  status: z.string().min(1, { message: "Status is required." }),
  sent: z.boolean(),
});

// -------------------------------------------------------------------
// GET: Retrieves announcements for an organization with optional search and pagination.
// It requires either a valid API key or an internal secret header.
// -------------------------------------------------------------------
export async function GET(req: NextRequest) {
  const apiKey = "tp_DntVJOYTwKaqUIblcpxWOpnydqZdZRyfhchlwCYSjYbJoXOuaZPSaMSQGLCbqpKO"
  //const apiKey = req.headers.get("x-api-key");
  const internalSecret = req.headers.get("x-internal-secret");
  let organizationId: string;

  // Extract query parameters from the request URL.
  const { searchParams } = new URL(req.url);
  const explicitOrgId = searchParams.get("organizationId");

  // Validate authentication using an API key.
  if (apiKey) {    
    const { valid, error, key } = await auth.api.verifyApiKey({ body: { key: apiKey } });
    if (!valid || !key) {
      return NextResponse.json({ error: error?.message || "Invalid API key" }, { status: 401 });
    }
    const session = await auth.api.getSession({ headers: req.headers });
    organizationId = session?.session.activeOrganizationId || "";
    if (!organizationId) {
      return NextResponse.json({ error: "Organization ID is required" }, { status: 400 });
    }
  }
  // Alternatively, validate via internal secret.
  else if (internalSecret === INTERNAL_API_SECRET) {
    const session = await auth.api.getSession({ headers: req.headers });
    if (!session) {
      return NextResponse.json({ error: "Unauthorized session" }, { status: 401 });
    }
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

  // Pagination and search parameters.
  const page = Number(searchParams.get("page")) || 1;
  const pageSize = Number(searchParams.get("pageSize")) || 10;
  const search = searchParams.get("search") || "";

  // Build the count query.
  let countQuery = `
    SELECT COUNT(*) FROM announcements
    WHERE "organizationId" = $1
  `;
  const countValues: any[] = [organizationId];
  if (search) {
    countQuery += ` AND (title ILIKE $2 OR content ILIKE $2)`;
    countValues.push(`%${search}%`);
  }

  // Build the select query with pagination and optional search.
  let query = `
    SELECT id, "organizationId", title, content, "expirationDate", countries, status, sent, "createdAt", "updatedAt"
    FROM announcements
    WHERE "organizationId" = $1
  `;
  const values: any[] = [organizationId];
  if (search) {
    query += ` AND (title ILIKE $2 OR content ILIKE $2)`;
    values.push(`%${search}%`);
  }
  query += ` ORDER BY "createdAt" DESC LIMIT $${values.length + 1} OFFSET $${values.length + 2}`;
  values.push(pageSize, (page - 1) * pageSize);

  try {
    // Execute count query.
    const countResult = await pool.query(countQuery, countValues);
    const totalRows = Number(countResult.rows[0].count);
    const totalPages = Math.ceil(totalRows / pageSize);

    // Execute select query.
    const result = await pool.query(query, values);
    const announcements = result.rows;
    announcements.map((announcement) => {
      announcement.countries = JSON.parse(announcement.countries)
    })    

    return NextResponse.json({
      announcements,
      totalPages,
      currentPage: page,
    });
  } catch (error: any) {
    console.error("[GET /api/announcements] error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// -------------------------------------------------------------------
// POST: Creates a new announcement for the active organization.
// It requires either a valid API key or an internal secret header.
// -------------------------------------------------------------------
export async function POST(req: NextRequest) {
  const apiKey = "tp_DntVJOYTwKaqUIblcpxWOpnydqZdZRyfhchlwCYSjYbJoXOuaZPSaMSQGLCbqpKO"
  //const apiKey = req.headers.get("x-api-key");
  const internalSecret = req.headers.get("x-internal-secret");
  let organizationId: string;

  // Validate authentication using an API key.
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
  }
  // Alternatively, validate via internal secret.
  else if (internalSecret === INTERNAL_API_SECRET) {
    const session = await auth.api.getSession({ headers: req.headers });
    if (!session) {
      return NextResponse.json({ error: "Unauthorized session" }, { status: 401 });
    }
    organizationId = session.session.activeOrganizationId;
    if (!organizationId) {
      return NextResponse.json({ error: "No active organization" }, { status: 400 });
    }
  } else {
    return NextResponse.json({ error: "Unauthorized: Provide either an API key or internal secret" }, { status: 403 });
  }

  try {
    // Parse and validate the request body.
    const body = await req.json();
    console.log(body)
    const parsedAnnouncement = announcementSchema.parse(body);
    const { title, content, expirationDate, countries, status, sent } = parsedAnnouncement;
    const announcementId = uuidv4();

    // Insert new announcement into the database.
    const insertQuery = `
      INSERT INTO announcements(id, "organizationId", title, content, "expirationDate", countries, status, sent, "createdAt", "updatedAt")
      VALUES($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())
      RETURNING *
    `;
    // Note: If your DB expects "countries" as JSON, you might want to JSON.stringify here; if it is text, leave as is.
    const values = [
      announcementId,
      organizationId,
      title,
      content,
      expirationDate,
      countries,
      status,
      sent,
    ];
    console.log(values)

    const result = await pool.query(insertQuery, values);
    return NextResponse.json(result.rows[0], { status: 201 });
  } catch (error: any) {
    console.error("[POST /api/announcements] error:", error);
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.errors }, { status: 400 });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
