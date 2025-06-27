// src/app/api/payment-methods/route.ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { pgPool as pool } from "@/lib/db";;
import { v4 as uuidv4 } from "uuid";
import { getContext } from "@/lib/context";



/* ---------------- zod schemas (unchanged) ---------------- */
const paymentCreateSchema = z.object({
  name: z.string().min(1, { message: "Name is required." }),
  active: z.boolean().optional().default(true),
  apiKey: z.string().optional().nullable(),
  secretKey: z.string().optional().nullable(),
});

const paymentRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  tenantId: z.string(),
  active: z.boolean(),
  apiKey: z.string(),
  secretKey: z.string(),
});

/* ========================================================= */
/* GET                                                       */
/* ========================================================= */
export async function GET(req: NextRequest) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;

  /* ---------------- NEW ---------------- */
  const { tenantId } = ctx;
  if (!tenantId)
    return NextResponse.json(
      { error: "No tenant found for the current credentials" },
      { status: 404 },
    );
  /* ------------------------------------- */

  const { searchParams } = new URL(req.url);
  const page     = Number(searchParams.get("page"))     || 1;
  const pageSize = Number(searchParams.get("pageSize")) || 10;
  const search   = searchParams.get("search") || "";

  /* count first --------------------------------------------------- */
  let countQuery   = `SELECT COUNT(*) FROM "paymentMethods" WHERE "tenantId" = $1`;
  const countVals: any[] = [tenantId];
  if (search) {
    countQuery += ` AND (name ILIKE $2 OR CAST(active AS TEXT) ILIKE $2)`;
    countVals.push(`%${search}%`);
  }

  /* data query ---------------------------------------------------- */
  let query = `
    SELECT id, name, active, "apiKey", "secretKey", "createdAt"
    FROM   "paymentMethods"
    WHERE  "tenantId" = $1
  `;
  const vals: any[] = [tenantId];
  if (search) {
    query += ` AND (name ILIKE $2 OR CAST(active AS TEXT) ILIKE $2)`;
    vals.push(`%${search}%`);
  }
  query += ` ORDER BY "createdAt" DESC LIMIT $${vals.length + 1} OFFSET $${vals.length + 2}`;
  vals.push(pageSize, (page - 1) * pageSize);

  try {
    const [{ count }] = (await pool.query(countQuery, countVals)).rows as { count: string }[];
    const totalRows   = Number(count);
    const totalPages  = Math.ceil(totalRows / pageSize);

    const { rows: methods } = await pool.query(query, vals);

    return NextResponse.json({ methods, totalPages, currentPage: page });
  } catch (error) {
    console.error("[GET /api/payment-methods] error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/* ========================================================= */
/* POST                                                      */
/* ========================================================= */
export async function POST(req: NextRequest) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;

  /* ---------------- NEW ---------------- */
  const { tenantId } = ctx;
  if (!tenantId)
    return NextResponse.json(
      { error: "No tenant found for the current credentials" },
      { status: 404 },
    );
  /* ------------------------------------- */

  try {
    const body          = await req.json();
    const { name, active, apiKey, secretKey } = paymentCreateSchema.parse(body);

    const id = uuidv4();
    const insertSql = `
      INSERT INTO "paymentMethods"
        (id, name, active, "apiKey", "secretKey", "tenantId", "createdAt", "updatedAt")
      VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
      RETURNING id, name, active, "apiKey", "secretKey"
    `;
    const vals = [id, name, active, apiKey, secretKey, tenantId];
    const { rows: [newMethod] } = await pool.query(insertSql, vals);

    return NextResponse.json(newMethod, { status: 201 });
  } catch (err) {
    console.error("[POST /api/payment-methods]", err);
    if (err instanceof z.ZodError)
      return NextResponse.json({ error: err.errors }, { status: 400 });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
