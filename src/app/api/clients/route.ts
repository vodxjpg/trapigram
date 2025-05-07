// src/app/api/clients/route.ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Pool } from "pg";
import { auth } from "@/lib/auth";
import { v4 as uuidv4 } from "uuid";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET as string;

/* ---------------------- Schema ---------------------- */
const clientSchema = z.object({
  username: z.string().min(3),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  email: z.string().email(),
  phoneNumber: z.string().min(1),
  referredBy: z.string().optional().nullable(),
  country: z.string().optional().nullable(),
});

/* ---------------------- Helpers ---------------------- */
function missingOrg() {
  return NextResponse.json(
    { error: "organizationId query parameter is required" },
    { status: 400 },
  );
}

/** resolve organization ID based on headers & query params */
async function resolveOrg(req: NextRequest): Promise<string | NextResponse> {
  const apiKey = req.headers.get("x-api-key");
  const intSecret = req.headers.get("x-internal-secret");
  const explicit = new URL(req.url).searchParams.get("organizationId");

  if (apiKey) {
    const { valid, error } = await auth.api.verifyApiKey({ body: { key: apiKey } });
    if (!valid) return NextResponse.json({ error: error?.message || "Invalid API key" }, { status: 401 });
    return explicit || missingOrg();
  }

  if (intSecret === INTERNAL_API_SECRET) {
    const session = await auth.api.getSession({ headers: req.headers });
    if (!session) return NextResponse.json({ error: "Unauthorized session" }, { status: 401 });
    return explicit || session.session.activeOrganizationId;
  }

  return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
}

/* ---------------------- GET /api/clients ---------------------- */
export async function GET(req: NextRequest) {
  const org = await resolveOrg(req);
  console.log(org+"---")
  if (org instanceof NextResponse) return org;
  const organizationId = org;

  /* pagination & search */
  const params = new URL(req.url).searchParams;
  const page = Number(params.get("page") || 1);
  const pageSize = Number(params.get("pageSize") || 10);
  const search = params.get("search") || "";

  /* total count */
  const countRes = await pool.query(
    `
    SELECT COUNT(*) FROM clients
    WHERE "organizationId" = $1
      AND ($2 = '' OR username ILIKE $3 OR "firstName" ILIKE $3
           OR "lastName" ILIKE $3 OR email ILIKE $3)
  `,
    [organizationId, search, `%${search}%`],
  );
  const totalRows = Number(countRes.rows[0].count);
  const totalPages = Math.ceil(totalRows / pageSize);

  /* data with balance */
  const dataRes = await pool.query(
    `
    SELECT c.*,
           COALESCE((
             SELECT SUM(points)
             FROM "affiliatePointLogs" apl
             WHERE apl."clientId" = c.id
               AND apl."organizationId" = $1
           ), 0) AS points
    FROM clients c
    WHERE c."organizationId" = $1
      AND ($2 = '' OR username ILIKE $3 OR "firstName" ILIKE $3
           OR "lastName" ILIKE $3 OR email ILIKE $3)
    ORDER BY c."createdAt" DESC
    LIMIT $4 OFFSET $5
  `,
    [organizationId, search, `%${search}%`, pageSize, (page - 1) * pageSize],
  );

  return NextResponse.json({ clients: dataRes.rows, totalPages, currentPage: page });
}

/* ---------------------- POST /api/clients ---------------------- */
export async function POST(req: NextRequest) {
  const org = await resolveOrg(req);
  if (org instanceof NextResponse) return org;
  const organizationId = org;

  try {
    const parsed = clientSchema.parse(await req.json());
    const userId = uuidv4();

    const insert = await pool.query(
      `
      INSERT INTO clients(
        id,"organizationId",username,"firstName","lastName",email,
        "phoneNumber","referredBy",country,"createdAt","updatedAt"
      )
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW(),NOW())
      RETURNING *
    `,
      [
        userId,
        organizationId,
        parsed.username,
        parsed.firstName,
        parsed.lastName,
        parsed.email,
        parsed.phoneNumber,
        parsed.referredBy,
        parsed.country,
      ],
    );

    return NextResponse.json(insert.rows[0], { status: 201 });
  } catch (e: any) {
    if (e instanceof z.ZodError)
      return NextResponse.json({ error: e.errors }, { status: 400 });
    console.error(e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
