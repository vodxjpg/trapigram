// src/app/api/product-categories/route.ts
/* ------------------------------------------------------------------
   Product-category list & CRUD
   – GET    → paginated list with product counts
   – POST   → create category
   – DELETE → bulk delete categories
   ------------------------------------------------------------------ */

   import { type NextRequest, NextResponse } from "next/server";
   import { z } from "zod";
   import { pgPool as pool } from "@/lib/db";
   import { v4 as uuidv4 } from "uuid";
   import { getContext } from "@/lib/context"; // tenant / org resolver
   
   const categorySchema = z.object({
     name: z.string().min(1, { message: "Name is required." }),
     slug: z.string().min(1, { message: "Slug is required." }),
     image: z.string().nullable().optional(),
     order: z.number().int().default(0),
     parentId: z.string().nullable().optional(),
   });
   
   export async function GET(req: NextRequest) {
     const ctx = await getContext(req);
     if (ctx instanceof NextResponse) return ctx;
     const { organizationId } = ctx;
   
     try {
       const { searchParams } = new URL(req.url);
       const page       = Number(searchParams.get("page"))     || 1;
       const pageSize   = Number(searchParams.get("pageSize")) || 10;
       const searchTerm = searchParams.get("search") || "";
   
       let countSql  = `SELECT COUNT(*) FROM "productCategories" WHERE "organizationId" = $1`;
       const countVals: any[] = [organizationId];
       if (searchTerm) {
         countSql   += ` AND (name ILIKE $2 OR slug ILIKE $2)`;
         countVals.push(`%${searchTerm}%`);
       }
       const [{ count }] = (await pool.query(countSql, countVals)).rows as [{ count: string }];
   
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
           COUNT(pcp."productId") AS product_count
         FROM "productCategories" pc
         LEFT JOIN "productCategory" pcp ON pc.id = pcp."categoryId"
         WHERE pc."organizationId" = $1`;
       const rowsVals: any[] = [organizationId];
       if (searchTerm) {
         rowsSql += ` AND (pc.name ILIKE $2 OR pc.slug ILIKE $2)`;
         rowsVals.push(`%${searchTerm}%`);
       }
       rowsSql += `
         GROUP BY pc.id, pc.name, pc.slug, pc.image,
                  pc."order", pc."parentId",
                  pc."organizationId", pc."createdAt", pc."updatedAt"
         ORDER BY pc."order" ASC, pc."createdAt" DESC
         LIMIT  $${rowsVals.length + 1}
         OFFSET $${rowsVals.length + 2}`;
       rowsVals.push(pageSize, (page - 1) * pageSize);
   
       const rawRows = (await pool.query(rowsSql, rowsVals)).rows as any[];
       const categories = rawRows.map(({ product_count, ...rest }) => ({
         ...rest,
         _count: { products: Number(product_count) || 0 },
       }));
       const totalPages = Math.ceil(Number(count) / pageSize);
   
       return NextResponse.json({ categories, totalPages, currentPage: page });
     } catch (error) {
       console.error("[GET /api/product-categories]", error);
       return NextResponse.json({ error: "Internal server error" }, { status: 500 });
     }
   }
   
   export async function POST(req: NextRequest) {
     const ctx = await getContext(req);
     if (ctx instanceof NextResponse) return ctx;
     const { organizationId } = ctx;
   
     try {
       const { name, slug, image, order, parentId } = categorySchema.parse(await req.json());
       const dup = await pool.query(
         `SELECT 1 FROM "productCategories" WHERE slug = $1 AND "organizationId" = $2 LIMIT 1`,
         [slug, organizationId],
       );
       if (dup.rowCount) {
         return NextResponse.json({ error: "Slug already exists" }, { status: 400 });
       }
       const id = uuidv4();
       const insertSQL = `
         INSERT INTO "productCategories"
           (id, name, slug, image, "order", "parentId", "organizationId", "createdAt", "updatedAt")
         VALUES ($1,$2,$3,$4,$5,$6,$7,NOW(),NOW())
         RETURNING *`;
       const values = [id, name, slug, image, order, parentId ?? null, organizationId];
       const { rows } = await pool.query(insertSQL, values);
       return NextResponse.json(rows[0], { status: 201 });
     } catch (error) {
       console.error("[POST /api/product-categories]", error);
       if (error instanceof z.ZodError) {
         return NextResponse.json({ error: error.errors }, { status: 400 });
       }
       return NextResponse.json({ error: "Internal server error" }, { status: 500 });
     }
   }
   
   // ────────────────────────────────────────────────────────────────────
   // Bulk delete multiple categories by ID
   // ────────────────────────────────────────────────────────────────────
   export async function DELETE(req: NextRequest) {
     const ctx = await getContext(req);
     if (ctx instanceof NextResponse) return ctx;
     const { organizationId } = ctx;
     const { ids } = await req.json() as { ids: string[] };
     const client = await pool.connect();
   
     try {
       await client.query("BEGIN");
       // 1) remove product–category links
       await client.query(
         `DELETE FROM "productCategory" WHERE "categoryId" = ANY($1)`,
         [ids]
       );
       // 2) orphan subcategories
       await client.query(
         `UPDATE "productCategories"
          SET "parentId" = NULL, "updatedAt" = NOW()
          WHERE "parentId" = ANY($1) AND "organizationId" = $2`,
         [ids, organizationId]
       );
       // 3) delete categories themselves
       const { rowCount } = await client.query(
         `DELETE FROM "productCategories"
          WHERE id = ANY($1) AND "organizationId" = $2`,
         [ids, organizationId]
       );
       await client.query("COMMIT");
       return NextResponse.json({ deletedCount: rowCount });
     } catch (err) {
       await client.query("ROLLBACK");
       console.error("[DELETE /api/product-categories]", err);
       return NextResponse.json({ error: "Failed to bulk-delete categories" }, { status: 500 });
     } finally {
       client.release();
     }
   }
   