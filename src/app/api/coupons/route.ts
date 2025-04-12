// File: src/app/api/coupons/route.ts

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Pool } from "pg";
import { auth } from "@/lib/auth";
import { v4 as uuidv4 } from "uuid";

// Create a new Postgres connection pool.
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
});

// Read the internal API secret from environment variables.
const INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET as string;
// -------------------------------------------------------------------
// Define the coupon schema using zod for input validation.
// This schema matches the fields from your coupons form:
// - name: text
// - code: text
// - description: text
// - usageLimit: number (must be 0 or more)
// - expendingLimit: number (must be 0 or more)
// - countries: an array of strings (at least one country code is required)
// - visibility: a boolean indicating if the coupon is visible
// -------------------------------------------------------------------
const couponSchema = z.object({
    name: z.string().min(1, { message: "Name is required." }),
    code: z.string().min(1, { message: "Code is required." }),
    description: z.string().min(1, { message: "Description is required." }),
    usageLimit: z.coerce.number().int().min(0, { message: "Usage limit must be at least 0." }),
    expendingLimit: z.coerce.number().int().min(0, { message: "Expending limit must be at least 0." }),
    countries: z.array(z.string()).min(1, { message: "At least one country is required." }),
    visibility: z.boolean(),
    expirationDate: z.string().nullable().optional(),
    limitPerUser: z.coerce.number().int().min(0, "Limit per user must be 0 or greater")
    .default(0),
});

// -------------------------------------------------------------------
// GET: Retrieves coupons for an organization with optional search and pagination.
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
        // For API key usage, organizationId must be provided via query parameters.
        const session = await auth.api.getSession({ headers: req.headers });
        organizationId = session?.session.activeOrganizationId || "";
        if (!organizationId) {
            return NextResponse.json({ error: "Organization ID is required in query parameters" }, { status: 400 });
        }
    }
    // Alternatively, validate via internal secret.
    else if (internalSecret === INTERNAL_API_SECRET) {
        const session = await auth.api.getSession({ headers: req.headers });
        if (!session) {
            return NextResponse.json({ error: "Unauthorized session" }, { status: 401 });
        }
        // Fallback to the session's active organization if not explicitly provided.
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
    // Read pagination and search parameters.
    const page = Number(searchParams.get("page")) || 1;
    const pageSize = Number(searchParams.get("pageSize")) || 10;
    const search = searchParams.get("search") || "";
    // Build the count query.
    let countQuery = `
    SELECT COUNT(*) FROM coupons
    WHERE "organizationId" = $1
  `;
    const countValues: any[] = [organizationId];
    if (search) {
        countQuery += ` AND (name ILIKE $2 OR code ILIKE $2 OR description ILIKE $2)`;
        countValues.push(`%${search}%`);
    }

    // Build the select query with pagination and optional search.
    let query = `
    SELECT id, "organizationId", "name", "code", "description", "expirationDate", "limitPerUser", "usagePerUser", "usageLimit", "expendingLimit", "countries", "visibility", "createdAt", "updatedAt"
    FROM coupons
    WHERE "organizationId" = $1
  `;
    const values: any[] = [organizationId];
    if (search) {
        query += ` AND (name ILIKE $2 OR code ILIKE $2 OR description ILIKE $2)`;
        values.push(`%${search}%`);
    }
    query += ` ORDER BY "createdAt" DESC LIMIT $${values.length + 1} OFFSET $${values.length + 2}`;
    values.push(pageSize, (page - 1) * pageSize);

    try {
        // Run the count query to determine total number of rows.
        const countResult = await pool.query(countQuery, countValues);
        const totalRows = Number(countResult.rows[0].count);
        const totalPages = Math.ceil(totalRows / pageSize);

        // Run the select query to fetch the coupons.
        const result = await pool.query(query, values);
        const coupons = result.rows;
        coupons.map((coupon) => {
            coupon.countries = JSON.parse(coupon.countries)
            console.log(coupon)
          }) 

        return NextResponse.json({
            coupons,
            totalPages,
            currentPage: page,
        });
    } catch (error: any) {
        console.error("[GET /api/coupons] error:", error);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}

// -------------------------------------------------------------------
// POST: Creates a new coupon for the active organization.
// It requires either a valid API key or an internal secret header.
// -------------------------------------------------------------------
export async function POST(req: NextRequest) {
    const apiKey = req.headers.get("x-api-key");
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
        // Parse and validate the request body using zod.
        const body = await req.json();
        console.log(body)
        const parsedCoupon = couponSchema.parse(body);        
        const { name, code, description, expirationDate, limitPerUser, usageLimit, expendingLimit, countries, visibility } = parsedCoupon;
        const couponId = uuidv4();

        // Insert the new coupon into the database.
        const insertQuery = `
      INSERT INTO coupons(id, "organizationId", name, code, description, "expirationDate", "limitPerUser", "usageLimit", "expendingLimit", countries, visibility, "createdAt", "updatedAt")
      VALUES($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW(), NOW())
      RETURNING *
    `;
        // Here, we stringify the countries array if your DB expects text.
        const values = [couponId, organizationId, name, code, description, expirationDate, limitPerUser, usageLimit, expendingLimit, JSON.stringify(countries), visibility];

        //const result = await pool.query(insertQuery, values);
        return NextResponse.json(result.rows[0], { status: 201 });
    } catch (error: any) {
        console.error("[POST /api/coupons] error:", error);
        if (error instanceof z.ZodError) {
            return NextResponse.json({ error: error.errors }, { status: 400 });
        }
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}
