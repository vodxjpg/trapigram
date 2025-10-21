// src/app/api/payment-methods/route.ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { pgPool as pool } from "@/lib/db";
import { v4 as uuidv4 } from "uuid";
import { getContext } from "@/lib/context";

/* ------------ zod schemas ------------ */
const paymentCreateSchema = z.object({
  name: z.string().min(1, { message: "Name is required." }),
  active: z.boolean().optional().default(true),
  posVisible: z.boolean().optional().default(true),
  apiKey: z.string().optional().nullable(),
  secretKey: z.string().optional().nullable(),
  description: z.string().optional().nullable(),
  instructions: z.string().optional().nullable(),
  default: z.boolean().optional().default(false),
});

/* =========================================================
   GET /api/payment-methods
   query params: page, pageSize, search, active, posVisible
   - active=true/false       -> filter by activity
   - posVisible=true/false   -> filter by POS visibility
   - active/posVisible absent -> no filter
   ========================================================= */
export async function GET(req: NextRequest) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;

  const { tenantId } = ctx as { tenantId: string | null };
  if (!tenantId) {
    return NextResponse.json(
      { error: "No tenant found for the current credentials" },
      { status: 404 }
    );
  }

  const { searchParams } = new URL(req.url);
  const page = Math.max(1, Number(searchParams.get("page")) || 1);
  const pageSize = Math.min(100, Number(searchParams.get("pageSize")) || 10);
  const search = (searchParams.get("search") || "").trim();

  // Parse boolean filters (allow "true"/"false"; anything else -> no filter)
  const parseBoolParam = (v: string | null): boolean | null => {
    if (v === "true") return true;
    if (v === "false") return false;
    return null;
  };
  const filterActive = parseBoolParam(searchParams.get("active"));
  const filterPos = parseBoolParam(searchParams.get("posVisible"));

  // -------- COUNT --------
  {
    const where: string[] = [`"tenantId" = $1`];
    const vals: any[] = [tenantId];
    let i = 2;

    if (filterActive !== null) {
      where.push(`active = $${i++}`);
      vals.push(filterActive);
    }
    if (filterPos !== null) {
      where.push(`COALESCE("posVisible", TRUE) = $${i++}`);
      vals.push(filterPos);
    }
    if (search) {
      where.push(
        `(
          name ILIKE $${i}
          OR CAST(active AS TEXT) ILIKE $${i}
          OR CAST("default" AS TEXT) ILIKE $${i}
          OR CAST("posVisible" AS TEXT) ILIKE $${i}
          OR COALESCE(description,'') ILIKE $${i}
          OR COALESCE(instructions,'') ILIKE $${i}
        )`
      );
      vals.push(`%${search}%`);
      i++;
    }

    const countSql = `SELECT COUNT(*) FROM "paymentMethods" WHERE ${where.join(" AND ")}`;
    try {
      const [{ count }] = (await pool.query(countSql, vals)).rows as { count: string }[];
      var totalRows = Number(count);
    } catch (error) {
      console.error("[GET /api/payment-methods][count] error:", error);
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
  }

  // -------- DATA --------
  const where: string[] = [`"tenantId" = $1`];
  const dataVals: any[] = [tenantId];
  let j = 2;

  if (filterActive !== null) {
    where.push(`active = $${j++}`);
    dataVals.push(filterActive);
  }
  if (filterPos !== null) {
    where.push(`COALESCE("posVisible", TRUE) = $${j++}`);
    dataVals.push(filterPos);
  }
  if (search) {
    where.push(
      `(
        name ILIKE $${j}
        OR CAST(active AS TEXT) ILIKE $${j}
        OR CAST("default" AS TEXT) ILIKE $${j}
        OR CAST("posVisible" AS TEXT) ILIKE $${j}
        OR COALESCE(description,'') ILIKE $${j}
        OR COALESCE(instructions,'') ILIKE $${j}
      )`
    );
    dataVals.push(`%${search}%`);
    j++;
  }

  const dataSql = `
    SELECT
      id, name, active, "posVisible", "apiKey", "secretKey",
      description, instructions, "default",
      "createdAt", "updatedAt"
    FROM "paymentMethods"
    WHERE ${where.join(" AND ")}
    ORDER BY "createdAt" DESC
    LIMIT $${j} OFFSET $${j + 1}
  `;
  dataVals.push(pageSize, (page - 1) * pageSize);

  try {
    const totalPages = Math.max(1, Math.ceil((totalRows ?? 0) / pageSize));
    const { rows: methods } = await pool.query(dataSql, dataVals);

    return NextResponse.json({
      methods,
      totalPages,
      currentPage: page,
    });
  } catch (error) {
    console.error("[GET /api/payment-methods] error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/* =========================================================
   POST /api/payment-methods
   body: { name, active?, posVisible?, apiKey?, secretKey?, description?, instructions?, default? }
   ========================================================= */
export async function POST(req: NextRequest) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;

  const { tenantId } = ctx as { tenantId: string | null };
  if (!tenantId) {
    return NextResponse.json(
      { error: "No tenant found for the current credentials" },
      { status: 404 }
    );
  }

  try {
    const body = await req.json();
    const parsed = paymentCreateSchema.parse(body);

    const id = uuidv4();
    const insertSql = `
      INSERT INTO "paymentMethods"
        (id, name, active, "posVisible", "apiKey", "secretKey",
         description, instructions, "default",
         "tenantId", "createdAt", "updatedAt")
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, NOW(), NOW())
      RETURNING
        id, name, active, "posVisible", "apiKey", "secretKey",
        description, instructions, "default",
        "createdAt", "updatedAt"
    `;
    const vals = [
      id,
      parsed.name,
      parsed.active ?? true,
      parsed.posVisible ?? true,
      parsed.apiKey ?? null,
      parsed.secretKey ?? null,
      parsed.description ?? null,
      parsed.instructions ?? null,
      parsed.default ?? false,
      tenantId,
    ];

    const { rows: [newMethod] } = await pool.query(insertSql, vals);

    return NextResponse.json(newMethod, { status: 201 });
  } catch (err) {
    console.error("[POST /api/payment-methods]", err);
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.errors }, { status: 400 });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
