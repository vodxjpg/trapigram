// /src/app/api/tickets/route.ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Pool } from "pg";
import { auth } from "@/lib/auth";
import { v4 as uuidv4 } from "uuid";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET as string;

/* -------------------------------------------------------------------------- */
/* 1. Zod schema                                                              */
/* -------------------------------------------------------------------------- */
const ticketSchema = z.object({
  title: z.string().min(1, "Title is required"),
  clientId: z.string().uuid(),              // Telegram user
  priority: z.enum(["low", "medium", "high"]).default("medium"),
  status: z.enum(["open", "in-progress", "closed"]).default("open"), // optional, but handy
});

/* -------------------------------------------------------------------------- */
/* 2. GET  /api/tickets                                                       */
/* -------------------------------------------------------------------------- */
export async function GET(req: NextRequest) {
  /* --- 2.1  Auth logic (same pattern you use for coupons) ---------------- */
  const apiKey = req.headers.get("x-api-key");
  const internalSecret = req.headers.get("x-internal-secret");
  const { searchParams } = new URL(req.url);

  const explicitOrgId = searchParams.get("organizationId");
  let organizationId: string;

  const session = await auth.api.getSession({ headers: req.headers });
  if (session) {
    organizationId = explicitOrgId || session.session.activeOrganizationId;
    if (!organizationId)
      return NextResponse.json({ error: "No active organization in session" }, { status: 400 });
  } else if (apiKey) {
    const { valid, error } = await auth.api.verifyApiKey({ body: { key: apiKey } });
    if (!valid) return NextResponse.json({ error: error?.message || "Invalid API key" }, { status: 401 });
    organizationId = explicitOrgId || "";
    if (!organizationId)
      return NextResponse.json({ error: "organizationId is required" }, { status: 400 });
  } else if (internalSecret === INTERNAL_API_SECRET) {
    const s = await auth.api.getSession({ headers: req.headers });
    if (!s) return NextResponse.json({ error: "Unauthorized session" }, { status: 401 });
    organizationId = explicitOrgId || s.session.activeOrganizationId;
    if (!organizationId)
      return NextResponse.json({ error: "No active organization in session" }, { status: 400 });
  } else {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  /* --- 2.2  Pagination + search ----------------------------------------- */
  const page = Number(searchParams.get("page")) || 1;
  const pageSize = Number(searchParams.get("pageSize")) || 10;
  const search = searchParams.get("search") || "";

  let countQuery = `SELECT COUNT(*) FROM tickets WHERE "organizationId" = $1`;
  const countVals: any[] = [organizationId];

  let query = `
    SELECT id, "organizationId", "clientId", title, priority, status, "createdAt", "updatedAt"
    FROM tickets
    WHERE "organizationId" = $1
  `;
  const vals: any[] = [organizationId];

  if (search) {
    countQuery += ` AND (title ILIKE $2)`;
    query += ` AND (title ILIKE $2)`;
    countVals.push(`%${search}%`);
    vals.push(`%${search}%`);
  }

  query += ` ORDER BY "createdAt" DESC LIMIT $${vals.length + 1} OFFSET $${vals.length + 2}`;
  vals.push(pageSize, (page - 1) * pageSize);

  try {
    const totalRows = Number((await pool.query(countQuery, countVals)).rows[0].count);
    const totalPages = Math.ceil(totalRows / pageSize);

    const tickets = (await pool.query(query, vals)).rows;
    console.log(tickets[0].id)

    return NextResponse.json({ tickets, totalPages, currentPage: page });
  } catch (err) {
    console.error("[GET /api/tickets]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/* -------------------------------------------------------------------------- */
/* 3. POST /api/tickets                                                       */
/* -------------------------------------------------------------------------- */
export async function POST(req: NextRequest) {
  /* --- 3.1  Auth (same block as above) ----------------------------------- */
  const apiKey = req.headers.get("x-api-key");
  const internalSecret = req.headers.get("x-internal-secret");
  const { searchParams } = new URL(req.url);

  const explicitOrgId = searchParams.get("organizationId");
  let organizationId: string;

  const session = await auth.api.getSession({ headers: req.headers });
  if (session) {
    organizationId = explicitOrgId || session.session.activeOrganizationId;
    if (!organizationId)
      return NextResponse.json({ error: "No active organization in session" }, { status: 400 });
  } else if (apiKey) {
    const { valid, error } = await auth.api.verifyApiKey({ body: { key: apiKey } });
    if (!valid) return NextResponse.json({ error: error?.message || "Invalid API key" }, { status: 401 });
    organizationId = explicitOrgId || "";
    if (!organizationId)
      return NextResponse.json({ error: "organizationId is required" }, { status: 400 });
  } else if (internalSecret === INTERNAL_API_SECRET) {
    const s = await auth.api.getSession({ headers: req.headers });
    if (!s) return NextResponse.json({ error: "Unauthorized session" }, { status: 401 });
    organizationId = explicitOrgId || s.session.activeOrganizationId;
    if (!organizationId)
      return NextResponse.json({ error: "No active organization in session" }, { status: 400 });
  } else {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  /* --- 3.2  Validate & insert ------------------------------------------- */
  try {
    const body = await req.json();
    const data = ticketSchema.parse(body); // throws if invalid

    const ticketId = uuidv4();
    const insert = `
      INSERT INTO tickets (id, "organizationId", "clientId", title, priority, status, "createdAt", "updatedAt")
      VALUES ($1,$2,$3,$4,$5,$6,NOW(),NOW())
      RETURNING *
    `;
    const vals = [
      ticketId,
      organizationId,
      data.clientId,
      data.title,
      data.priority,
      data.status,
    ];

    const result = await pool.query(insert, vals);
    return NextResponse.json(result.rows[0], { status: 201 });
  } catch (err: any) {
    console.error("[POST /api/tickets]", err);
    if (err instanceof z.ZodError)
      return NextResponse.json({ error: err.errors }, { status: 400 });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
