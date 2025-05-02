// src/app/api/affiliate/points/route.ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Pool } from "pg";
import { auth } from "@/lib/auth";
import { v4 as uuidv4 } from "uuid";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET as string;

/*──────── Schemas ────────*/
const pointCreateSchema = z.object({
  id: z.string().min(1, { message: "id is required." }), // 👈 client id in payload
  points: z.number().int(),
  action: z.string().min(1),
  description: z.string().optional().nullable(),
  sourceId: z.string().optional().nullable(),
});

const pointQuerySchema = z.object({
  id: z.string().optional(),
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(100).default(10),
});

/*──────── resolveOrgId ────────*/
async function resolveOrgId(req: NextRequest): Promise<string | NextResponse> {
  const apiKey = req.headers.get("x-api-key");
  const intSecret = req.headers.get("x-internal-secret");
  const explicit = new URL(req.url).searchParams.get("organizationId");

  if (apiKey) {
    const { valid, error } = await auth.api.verifyApiKey({ body: { key: apiKey } });
    if (!valid) return NextResponse.json({ error: error?.message }, { status: 401 });
    return explicit ?? NextResponse.json({ error: "organizationId required" }, { status: 400 });
  }

  if (intSecret === INTERNAL_API_SECRET) {
    const session = await auth.api.getSession({ headers: req.headers });
    if (!session) return NextResponse.json({ error: "Unauthorized session" }, { status: 401 });
    return explicit || session.session.activeOrganizationId;
  }

  return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
}

/*──────── GET ────────*/
export async function GET(req: NextRequest) {
  const org = await resolveOrgId(req);
  if (org instanceof NextResponse) return org;
  const organizationId = org;

  const qp = pointQuerySchema.parse(
    Object.fromEntries(new URL(req.url).searchParams.entries()),
  );
  const { id, page, pageSize } = qp;
  const where: string[] = [`"organizationId" = $1`];
  const vals: any[] = [organizationId];
  if (id) {
    where.push(`"clientId" = $2`);
    vals.push(id);
  }

  const [{ count }] = (
    await pool.query(
      `SELECT COUNT(*) FROM "affiliatePointLogs" WHERE ${where.join(" AND ")}`,
      vals,
    )
  ).rows;
  const totalPages = Math.ceil(Number(count) / pageSize);

  const { rows } = await pool.query(
    `
      SELECT id,"clientId","organizationId",points,action,description,
             "sourceClientId","createdAt","updatedAt"
      FROM "affiliatePointLogs"
      WHERE ${where.join(" AND ")}
      ORDER BY "createdAt" DESC
      LIMIT $${vals.length + 1} OFFSET $${vals.length + 2}
    `,
    [...vals, pageSize, (page - 1) * pageSize],
  );

  return NextResponse.json({ logs: rows, totalPages, currentPage: page });
}

/*──────── POST ────────*/
export async function POST(req: NextRequest) {
  const org = await resolveOrgId(req);
  if (org instanceof NextResponse) return org;
  const organizationId = org;

  try {
    const parsed = pointCreateSchema.parse(await req.json());
    const id = uuidv4();

    const { rows } = await pool.query(
      `
      INSERT INTO "affiliatePointLogs"(
        id,"organizationId","clientId",points,action,description,"sourceClientId",
        "createdAt","updatedAt"
      )
      VALUES($1,$2,$3,$4,$5,$6,$7,NOW(),NOW())
      RETURNING *
      `,
      [
        id,
        organizationId,
        parsed.id, // 👈 map payload id → clientId column
        parsed.points,
        parsed.action,
        parsed.description ?? null,
        parsed.sourceId ?? null,
      ],
    );

    return NextResponse.json(rows[0], { status: 201 });
  } catch (e: any) {
    if (e instanceof z.ZodError)
      return NextResponse.json({ error: e.errors }, { status: 400 });
    console.error(e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
