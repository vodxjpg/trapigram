// src/app/api/payment-methods/route.ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Pool } from "pg";
import { auth } from "@/lib/auth";
import { v4 as uuidv4 } from "uuid";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

const INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET as string;

// ———————— Zod schemas ————————

// Payload for creating a new payment method
const paymentCreateSchema = z.object({
  name: z.string().min(1, { message: "Name is required." }),
  active: z.boolean().optional().default(true),
  apiKey: z.string().optional().nullable(),
  secretKey: z.string().optional().nullable()
});

// The shape we return in each row
const paymentRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  tenantId: z.string(),
  active: z.boolean(),
  apiKey: z.string(),
  secretKey: z.string()
});

// ———————— GET / POST handler ————————
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

  const userId = session.user.id

  let tenantQuery = `
  SELECT * FROM tenant
  WHERE "ownerUserId" = $1
  `
  const tenantValues: any[] = [userId]
  const tenantResult = await pool.query(tenantQuery, tenantValues);
  const tenantId = tenantResult.rows[0].id

  let countQuery = `
    SELECT COUNT(*) FROM "paymentMethods"
    WHERE "tenantId" = $1
  `;
  const countValues: any[] = [tenantId];
  if (search) {
    countQuery += ` AND (name ILIKE $2 OR active ILIKE $2)`;
    countValues.push(`%${search}%`);
  }

  let query = `
    SELECT id, name, active, "apiKey", "secretKey", "createdAt"
    FROM "paymentMethods"
    WHERE "tenantId" = $1
  `;
  const values: any[] = [tenantId];
  if (search) {
    query += ` AND (name ILIKE $2 OR active ILIKE $2)`;
    values.push(`%${search}%`);
  }
  query += ` ORDER BY "createdAt" DESC LIMIT $${values.length + 1} OFFSET $${values.length + 2}`;
  values.push(pageSize, (page - 1) * pageSize);

  try {
    const countResult = await pool.query(countQuery, countValues);
    const totalRows = Number(countResult.rows[0].count);
    const totalPages = Math.ceil(totalRows / pageSize);

    const result = await pool.query(query, values);
    const methods = result.rows;

    return NextResponse.json({
      methods,
      totalPages,
      currentPage: page,
    });
  } catch (error: any) {
    console.error("[GET /api/payment-methods] error:", error);
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

  const userId = session.user.id

  const tenantQuery = `
  SELECT * FROM tenant
  WHERE "ownerUserId" = $1
  `
  const tenantValues: any[] = [userId]
  const tenantResult = await pool.query(tenantQuery, tenantValues);
  const tenantId = tenantResult.rows[0].id

  try {
    const body = await req.json();
    const { name, active, apiKey, secretKey } = paymentCreateSchema.parse(body);

    const id = uuidv4();
    const insertSql = `
      INSERT INTO "paymentMethods" (id, name, active, "apiKey", "secretKey", "tenantId", "createdAt", "updatedAt")
      VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
      RETURNING id, name, active, "apiKey", "secretKey"
    `;

    const values = [
      id,
      name,
      active,
      apiKey,
      secretKey,
      tenantId      
    ];
    const res = await pool.query(insertSql, values);
    const newMethod = res.rows[0];

    return NextResponse.json(newMethod, { status: 201 });
  } catch (err: any) {
    console.error("[POST /api/payment-methods]", err);
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.errors }, { status: 400 });
    }
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
