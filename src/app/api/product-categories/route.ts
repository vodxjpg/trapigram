// src/app/api/product-categories/route.ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { pgPool as pool } from "@/lib/db";;
import { v4 as uuidv4 } from "uuid";
import { getContext } from "@/lib/context";   // ← central auth / tenant resolver

/* ────────────────────────────────────────────────────────────────
   DB
   ──────────────────────────────────────────────────────────────── */


/* ────────────────────────────────────────────────────────────────
   Zod schema
   ──────────────────────────────────────────────────────────────── */
const categorySchema = z.object({
  name: z.string().min(1, { message: "Name is required." }),
  slug: z.string().min(1, { message: "Slug is required." }),
  image: z.string().nullable().optional(),
  order: z.number().int().default(0),
  parentId: z.string().nullable().optional(),
});

/* ------------------------------------------------------------------
   GET – list categories (unchanged)
   ------------------------------------------------------------------ */
export async function GET(req: NextRequest) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { organizationId } = ctx;

  try {
    const { searchParams } = new URL(req.url);
    const page     = Number(searchParams.get("page"))     || 1;
    const pageSize = Number(searchParams.get("pageSize")) || 10;
    const search   = searchParams.get("search") || "";

    /* count */
    let countSql    = `SELECT COUNT(*) FROM "productCategories" WHERE "organizationId" = $1`;
    const countVals = [organizationId];
    if (search) {
      countSql   += ` AND (name ILIKE $2 OR slug ILIKE $2)`;
      countVals.push(`%${search}%`);
    }

    /* rows */
    let rowsSql = `
       SELECT
     pc.id,
     pc.name,
     pc.slug,
     pc.image,
     pc."order",
     pc."parentId",
     pc."organizationId",
     pc."createdAt",
     pc."updatedAt",
     /* ---- new ---- */
     COUNT(pcp."productId")            AS product_count
   FROM "productCategories" pc
   /* count relations; still works if none exist                      */
   LEFT JOIN "productCategoryProducts" pcp
     ON pc.id = pcp."categoryId"
   WHERE pc."organizationId" = $1
    `;
    const rowsVals: any[] = [organizationId];
    if (search) {
      rowsSql  += ` AND (name ILIKE $2 OR slug ILIKE $2)`;
      rowsVals.push(`%${search}%`);
    }
     rowsSql += `
       GROUP BY pc.id, pc.name, pc.slug, pc.image,
                pc."order", pc."parentId",
                pc."organizationId", pc."createdAt", pc."updatedAt"
       ORDER BY pc."order" ASC, pc."createdAt" DESC
       LIMIT  $${rowsVals.length + 1}
       OFFSET $${rowsVals.length + 2}
     `;
    rowsVals.push(pageSize, (page - 1) * pageSize);

    const [{ count }]    = (await pool.query(countSql, countVals)).rows;
    const categories     = (await pool.query(rowsSql, rowsVals)).rows;
    const totalPages     = Math.ceil(Number(count) / pageSize);

    return NextResponse.json({ categories, totalPages, currentPage: page });
  } catch (error) {
    console.error("[GET /api/product-categories]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/* ------------------------------------------------------------------
   POST – create category (now uses getContext)
   ------------------------------------------------------------------ */
export async function POST(req: NextRequest) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { organizationId } = ctx;

  try {
    /* 1 – validate body */
    const parsed = categorySchema.parse(await req.json());
    const { name, slug, image, order, parentId } = parsed;

    /* 2 – unique slug per organisation */
    const dup = await pool.query(
      `SELECT 1 FROM "productCategories" WHERE slug = $1 AND "organizationId" = $2 LIMIT 1`,
      [slug, organizationId],
    );
    if (dup.rowCount) {
      return NextResponse.json({ error: "Slug already exists" }, { status: 400 });
    }

    /* 3 – insert */
    const id   = uuidv4();
    const ins  = `
      INSERT INTO "productCategories"
        (id, name, slug, image, "order", "parentId", "organizationId", "createdAt", "updatedAt")
      VALUES ($1,$2,$3,$4,$5,$6,$7,NOW(),NOW())
      RETURNING *
    `;
    const vals = [id, name, slug, image, order, parentId ?? null, organizationId];
    const { rows } = await pool.query(ins, vals);

    return NextResponse.json(rows[0], { status: 201 });
  } catch (error) {
    console.error("[POST /api/product-categories]", error);
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.errors }, { status: 400 });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
