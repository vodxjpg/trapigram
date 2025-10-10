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
  apiKey: z.string().optional().nullable(),
  secretKey: z.string().optional().nullable(),
  description: z.string().optional().nullable(),
  instructions: z.string().optional().nullable(),
  default: z.boolean().optional().default(false),
});

/* =========================================================
   GET /api/payment-methods
   query params: page, pageSize, search, active
   - active=true  -> only return active methods
   - active absent -> return all methods
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

  // optional filter: only active methods when active=true
  const activeParam = searchParams.get("active");
  const filterActive = activeParam === "true";

  // count
  let countSql = `SELECT COUNT(*) FROM "paymentMethods" WHERE "tenantId" = $1`;
  const countVals: any[] = [tenantId];

  if (filterActive) {
    countSql += ` AND active = TRUE`;
  }

  if (search) {
    // NOTE: $2 is safe here because we didn't add any bound param for 'active'
    countSql += `
      AND (
        name ILIKE $2
        OR CAST(active AS TEXT) ILIKE $2
        OR CAST("default" AS TEXT) ILIKE $2
        OR COALESCE(description,'') ILIKE $2
        OR COALESCE(instructions,'') ILIKE $2
      )
    `;
    countVals.push(`%${search}%`);
  }

  // data
  let dataSql = `
    SELECT
      id, name, active, "apiKey", "secretKey",
      description, instructions, "default",
      "createdAt", "updatedAt"
    FROM "paymentMethods"
    WHERE "tenantId" = $1
  `;
  const dataVals: any[] = [tenantId];

  if (filterActive) {
    dataSql += ` AND active = TRUE`;
  }

  if (search) {
    // NOTE: $2 is safe here for the same reason as above
    dataSql += `
      AND (
        name ILIKE $2
        OR CAST(active AS TEXT) ILIKE $2
        OR CAST("default" AS TEXT) ILIKE $2
        OR COALESCE(description,'') ILIKE $2
        OR COALESCE(instructions,'') ILIKE $2
      )
    `;
    dataVals.push(`%${search}%`);
  }

  dataSql += ` ORDER BY "createdAt" DESC LIMIT $${dataVals.length + 1} OFFSET $${dataVals.length + 2}`;
  dataVals.push(pageSize, (page - 1) * pageSize);

  try {
    const [{ count }] = (await pool.query(countSql, countVals)).rows as { count: string }[];
    const totalRows = Number(count);
    const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));

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
   body: { name, active?, apiKey?, secretKey?, description?, instructions?, default? }
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
        (id, name, active, "apiKey", "secretKey",
         description, instructions, "default",
         "tenantId", "createdAt", "updatedAt")
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, NOW(), NOW())
      RETURNING
        id, name, active, "apiKey", "secretKey",
        description, instructions, "default",
        "createdAt", "updatedAt"
    `;
    const vals = [
      id,
      parsed.name,
      parsed.active ?? true,
      parsed.apiKey ?? null,
      parsed.secretKey ?? null,
      parsed.description ?? null,
      parsed.instructions ?? null,
      parsed.default ?? false,
      tenantId,
    ];

    const { rows: [newMethod] } = await pool.query(insertSql, vals);

    // (Optional) If you want only one default per tenant, uncomment:
    // if (parsed.default) {
    //   await pool.query(
    //     `UPDATE "paymentMethods"
    //         SET "default" = FALSE, "updatedAt" = NOW()
    //       WHERE "tenantId" = $1 AND id <> $2 AND "default" = TRUE`,
    //     [tenantId, id]
    //   );
    // }

    return NextResponse.json(newMethod, { status: 201 });
  } catch (err) {
    console.error("[POST /api/payment-methods]", err);
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.errors }, { status: 400 });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
