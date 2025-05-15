// src/app/api/clients/route.ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Pool } from "pg";
import { v4 as uuidv4 } from "uuid";
import { getContext } from "@/lib/context";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

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

/* ---------------------- GET /api/clients ---------------------- */
export async function GET(req: NextRequest) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { organizationId } = ctx;


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
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { organizationId } = ctx;

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
