// src/app/api/payment-methods/route.ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Pool } from "pg";
import { v4 as uuidv4 } from "uuid";
import { getContext } from "@/lib/context";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

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
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { userId } = ctx;
  const { searchParams } = new URL(req.url);

  const page = Number(searchParams.get("page")) || 1;
  const pageSize = Number(searchParams.get("pageSize")) || 10;
  const search = searchParams.get("search") || "";

  const tenantQuery = `
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
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { userId } = ctx;

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
