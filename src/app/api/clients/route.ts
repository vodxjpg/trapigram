// src/app/api/clients/route.ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { pgPool as pool } from "@/lib/db";
import { v4 as uuidv4 } from "uuid";
import { getContext } from "@/lib/context";

/* ---------------------- Schema ---------------------- */
const clientSchema = z.object({
  userId: z.string().min(1).nullable().optional(),
  username: z.string().min(1).nullable().optional(),
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

  const params = new URL(req.url).searchParams;
  const page = Number(params.get("page") || 1);
  const pageSize = Number(params.get("pageSize") || 10);
  const search = params.get("search") || "";

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

/* ---------------------- POST /api/clients (enhanced upsert) ---------------------- */
export async function POST(req: NextRequest) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { organizationId } = ctx;

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

  if (!organizationId) {
    return NextResponse.json({ error: "organizationId is required" }, { status: 400 });
  }

  // must have at least one stable key to match safely
  const hasStableKey = (userId && userId !== "") || (username && username !== "") || (email && email !== "");
  if (!hasStableKey) {
    return NextResponse.json(
      { error: "Provide at least one of userId, username, or email for safe upsert." },
      { status: 400 },
    );
  }

  // Build exact-match lookup by strict precedence (no ORs):
  // 1) userId  →  2) username  →  3) email
  let where = `"organizationId" = $1 AND "userId" = $2`;
  let selector: "userId" | "username" | "email" = "userId";
  let values: any[] = [organizationId, userId];

  if (!userId || userId === "") {
    if (username && username !== "") {
      where = `"organizationId" = $1 AND LOWER(username) = LOWER($2)`;
      selector = "username";
      values = [organizationId, username];
    } else if (email && email !== "") {
      where = `"organizationId" = $1 AND LOWER(email) = LOWER($2)`;
      selector = "email";
      values = [organizationId, email];
    } else {
      // should not happen because of hasStableKey guard above
      return NextResponse.json(
        { error: "Provide one of userId, username or email." },
        { status: 400 },
      );
    }
  }

  const existingRes = await pool.query(
    `SELECT id FROM clients WHERE ${where}`,
    values,
  );

  if (existingRes.rowCount > 1) {
    return NextResponse.json(
      {
        error: `Ambiguous match: multiple clients share the same ${selector} within this organization.`,
        matches: existingRes.rows,
      },
      { status: 409 },
    );
  }
  if (existingRes.rowCount === 1) {
    // Update existing client
    const { id } = existingRes.rows[0];
    const updateRes = await pool.query(
      `
      UPDATE clients
      SET
        username          = COALESCE($2, username),
        "firstName"       = COALESCE($3, "firstName"),
        "lastName"        = COALESCE($4, "lastName"),
        email             = COALESCE($5, email),
        "phoneNumber"     = COALESCE($6, "phoneNumber"),
        country           = COALESCE($7, country),
        "levelId"         = COALESCE($8, "levelId"),
        "referredBy"      = CASE WHEN "referredBy" IS NULL THEN $9 ELSE "referredBy" END,
        "lastInteraction" = NOW(),
        "updatedAt"       = NOW()
      WHERE id = $1
      RETURNING *
      `,
      [
        id,
        username ?? null,
        firstName ?? null,
        lastName,
        email,
        phoneNumber,
        country,
        levelId,
        referredBy,
      ],
    );
    return NextResponse.json(updateRes.rows[0], { status: 200 });
  }

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
      userId ?? null,
      username ?? null,
      firstName ?? null,
      lastName,
      email,
      phoneNumber,
      country,
      levelId,
      referredBy,
    ],
  );
  return NextResponse.json(insertRes.rows[0], { status: 201 });
}
