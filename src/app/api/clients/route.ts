// src/app/api/clients/route.ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Pool } from "pg";
import { v4 as uuidv4 } from "uuid";
import { getContext } from "@/lib/context";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

/* ---------------------- Schema ---------------------- */
const clientSchema = z.object({
  userId: z.string().min(1),
  username: z.string().min(1),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  email: z.string().optional().nullable(),
  phoneNumber: z.string().optional().nullable(),
  country: z.string().optional().nullable(),
  levelId: z.string().optional().nullable(),
  referredBy: z.string().optional().nullable(),
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

  const parsed = clientSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const {
    userId,
    username,
    firstName,
    lastName,
    email = null,
    phoneNumber = null,
    country = null,
    levelId = null,
    referredBy = null,
  } = parsed.data;

  try {
    // Look for existing by org + telegram chat ID
    const existingRes = await pool.query(
      `SELECT id FROM clients WHERE "organizationId" = $1 AND "userId" = $2`,
      [organizationId, userId]
    );

    if (existingRes.rowCount > 0) {
      // UPDATE existing: note placeholders $1..$9 are all used
      const { id } = existingRes.rows[0];
      const updateRes = await pool.query(
        `
        UPDATE clients
        SET
          username      = $2,
          "firstName"   = $3,
          "lastName"    = $4,
          email         = $5,
          "phoneNumber" = $6,
          country       = $7,
          "levelId"     = $8,
          "referredBy"  = $9,
          "lastInteraction" = NOW(),
          "updatedAt"       = NOW()
        WHERE id = $1
        RETURNING *
        `,
        [
          id,
          username,
          firstName,
          lastName,
          email,
          phoneNumber,
          country,
          levelId,
          referredBy,
        ]
      );
      return NextResponse.json(updateRes.rows[0], { status: 200 });
    } else {
      // INSERT new
      const insertRes = await pool.query(
        `
        INSERT INTO clients
          ("organizationId","userId",username,"firstName","lastName",
           email,"phoneNumber",country,"levelId","referredBy",
           "lastInteraction","createdAt","updatedAt")
        VALUES
          ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW(),NOW(),NOW())
        RETURNING *
        `,
        [
          organizationId,
          userId,
          username,
          firstName,
          lastName,
          email,
          phoneNumber,
          country,
          levelId,
          referredBy,
        ]
      );
      return NextResponse.json(insertRes.rows[0], { status: 201 });
    }
  } catch (error) {
    console.error("[POST /api/clients] error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
