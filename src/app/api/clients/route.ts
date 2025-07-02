// src/app/api/clients/route.ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { pgPool as pool } from "@/lib/db";      // ← one line, done ✅
import { v4 as uuidv4 } from "uuid";
import { getContext } from "@/lib/context";

/* ---------------------- Schema ---------------------- */
const clientSchema = z.object({
  userId: z.string().min(1).nullable(),
  username: z.string().min(1).nullable(),
  firstName: z.string().min(1).nullable(),
  lastName: z.string().optional().nullable(),
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
  const body = await req.json();
  const parsed = clientSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const {
    userId,
    username,
    firstName,
    lastName = null,
    email = null,
    phoneNumber = null,
    country = null,
    levelId = null,
    referredBy = null,
  } = parsed.data;

  const organizationId = req.nextUrl.searchParams.get("organizationId");
  if (!organizationId) {
    return NextResponse.json({ error: "organizationId is required" }, { status: 400 });
  }

  // Check if client exists
  const existingRes = await pool.query(
    `SELECT id FROM clients WHERE "organizationId" = $1 AND "userId" = $2`,
    [organizationId, userId]
  );

  if (existingRes.rowCount > 0) {
    // Update existing client
    const { id } = existingRes.rows[0];
    const updateRes = await pool.query(
      `
      UPDATE clients
      SET
        username          = $2,
        "firstName"      = $3,
        "lastName"       = COALESCE($4, "lastName"),
        email             = $5,
        "phoneNumber"    = $6,
        country           = $7,
        "levelId"        = COALESCE($8, "levelId"),
        "referredBy"     = CASE WHEN "referredBy" IS NULL THEN $9 ELSE "referredBy" END,
        "lastInteraction"= NOW(),
        "updatedAt"      = NOW()
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
    // Insert new client
    const id = crypto.randomUUID();
    const insertRes = await pool.query(
      `
      INSERT INTO clients
        ("id", "organizationId", "userId", username, "firstName", "lastName",
         email, "phoneNumber", country, "levelId", "referredBy",
         "lastInteraction", "createdAt", "updatedAt")
      VALUES
        ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW(), NOW(), NOW())
      RETURNING *
      `,
      [
        id,
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
}