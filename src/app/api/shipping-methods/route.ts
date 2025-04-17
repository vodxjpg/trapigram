// src/app/api/shippingMethods/route.ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Pool } from "pg";
import { auth } from "@/lib/auth";
import { v4 as uuidv4 } from "uuid";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});
const INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET as string;

// Schema for creating a shipping method
const shippingMethodSchema = z.object({
  name: z.string().min(1, "Name is required"),
  countries: z.array(z.string().length(2)).min(1, "At least one country is required"),
  organizationId: z.string().min(1, { message: "Organization is required." }),
});

export async function GET(req: NextRequest) {
  const apiKey = req.headers.get("x-api-key");
  const internalSecret = req.headers.get("x-internal-secret");
  let organizationId: string;

  const { searchParams } = new URL(req.url);
  const explicitOrgId = searchParams.get("organizationId");

  // --- AUTHENTICATION (same pattern as your other endpoints) ---
  const session = await auth.api.getSession({ headers: req.headers });
  if (session) {
    organizationId = explicitOrgId || session.session.activeOrganizationId;
    if (!organizationId)
      return NextResponse.json({ error: "No active organization in session" }, { status: 400 });
  } else if (apiKey) {
    const { valid, key, error } = await auth.api.verifyApiKey({ body: { key: apiKey } });
    if (!valid || !key)
      return NextResponse.json({ error: error?.message || "Invalid API key" }, { status: 401 });
    organizationId = explicitOrgId || "";
    if (!organizationId)
      return NextResponse.json({ error: "Organization ID required" }, { status: 400 });
  } else if (internalSecret === INTERNAL_API_SECRET) {
    const internalSession = await auth.api.getSession({ headers: req.headers });
    if (!internalSession)
      return NextResponse.json({ error: "Unauthorized session" }, { status: 401 });
    organizationId = explicitOrgId || internalSession.session.activeOrganizationId;
    if (!organizationId)
      return NextResponse.json({ error: "No active organization in session" }, { status: 400 });
  } else {
    return NextResponse.json(
      { error: "Unauthorized: session, API key or internal secret required" },
      { status: 403 }
    );
  }

  // pagination & optional search
  const page = Number(searchParams.get("page") ?? 1);
  const pageSize = Number(searchParams.get("pageSize") ?? 10);
  const search = searchParams.get("search") || "";

  // count total
  let countQuery = `SELECT COUNT(*) FROM shippingmethods WHERE "organizationId" = $1`;
  const countValues: any[] = [organizationId];
  if (search) {
    countQuery += ` AND name ILIKE $2`;
    countValues.push(`%${search}%`);
  }

  // fetch paginated
  let selQuery = `
    SELECT id, "organizationId", name, countries, "createdAt", "updatedAt"
    FROM shippingmethods
    WHERE "organizationId" = $1
  `;
  const values: any[] = [organizationId];
  if (search) {
    selQuery += ` AND name ILIKE $2`;
    values.push(`%${search}%`);
  }
  selQuery += ` ORDER BY "createdAt" DESC LIMIT $${values.length + 1} OFFSET $${values.length + 2}`;
  values.push(pageSize, (page - 1) * pageSize);

  try {
    const countRes = await pool.query(countQuery, countValues);
    const totalRows = Number(countRes.rows[0].count);
    const totalPages = Math.ceil(totalRows / pageSize);

    const result = await pool.query(selQuery, values);
    const shippingMethods = result.rows.map((row) => ({
      ...row,
      countries: JSON.parse(row.countries),
    }));

    return NextResponse.json({
      shippingMethods,
      totalPages,
      currentPage: page,
    });
  } catch (err: any) {
    console.error("[GET /api/shippingMethods] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const apiKey = req.headers.get("x-api-key");
  const internalSecret = req.headers.get("x-internal-secret");
  let organizationId: string;

  const { searchParams } = new URL(req.url);
  const explicitOrgId = searchParams.get("organizationId");

  // --- Same auth logic as above ---
  const session = await auth.api.getSession({ headers: req.headers });
  if (session) {
    organizationId = explicitOrgId || session.session.activeOrganizationId;
    if (!organizationId)
      return NextResponse.json({ error: "No active organization in session" }, { status: 400 });
  } else if (apiKey) {
    const { valid, key, error } = await auth.api.verifyApiKey({ body: { key: apiKey } });
    if (!valid || !key)
      return NextResponse.json({ error: error?.message || "Invalid API key" }, { status: 401 });
    organizationId = explicitOrgId || "";
    if (!organizationId)
      return NextResponse.json({ error: "Organization ID required" }, { status: 400 });
  } else if (internalSecret === INTERNAL_API_SECRET) {
    const internalSession = await auth.api.getSession({ headers: req.headers });
    if (!internalSession)
      return NextResponse.json({ error: "Unauthorized session" }, { status: 401 });
    organizationId = explicitOrgId || internalSession.session.activeOrganizationId;
    if (!organizationId)
      return NextResponse.json({ error: "No active organization in session" }, { status: 400 });
  } else {
    return NextResponse.json(
      { error: "Unauthorized: session, API key or internal secret required" },
      { status: 403 }
    );
  }

  try {
    const payload = await req.json();
    payload.countries = JSON.parse(payload.countries)
    const parsed = shippingMethodSchema.parse({...payload, organizationId});

    const id = uuidv4();
    const url = "https://parcelsapp.com/en/tracking/"
    const insertQ = `
      INSERT INTO shippingmethods
        (id, "organizationId", name, countries, url, "createdAt", "updatedAt")
      VALUES ($1,$2,$3,$4,$5,NOW(),NOW())
      RETURNING *
    `;
    const vals = [id, organizationId, parsed.name, JSON.stringify(parsed.countries), url];
    const res = await pool.query(insertQ, vals);
    const created = res.rows[0];
    created.countries = JSON.parse(created.countries);
    return NextResponse.json(created, { status: 201 });
  } catch (err: any) {
    console.error("[POST /api/shipping-methods] error:", err);
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.errors }, { status: 400 });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
