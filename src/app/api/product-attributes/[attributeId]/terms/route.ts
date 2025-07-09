// src/app/api/product-attributes/[attributeId]/terms/route.ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { pgPool as pool } from "@/lib/db";
import { v4 as uuidv4 } from "uuid";
import { getContext } from "@/lib/context";

const termSchema = z.object({
  name: z.string().min(1, "Name is required"),
  slug: z.string().min(1, "Slug is required"),
});

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ attributeId: string }> }
) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { organizationId } = ctx;
  const { searchParams } = new URL(req.url);
  const page     = Number(searchParams.get("page"))     || 1;
  const pageSize = Number(searchParams.get("pageSize")) || 10;
  const search   = searchParams.get("search") || "";
  const { attributeId } = await params;

  try {
    // count
    const countQuery = `
      SELECT COUNT(*) FROM "productAttributeTerms"
      WHERE "attributeId" = $1 AND "organizationId" = $2
      ${search ? "AND (name ILIKE $3 OR slug ILIKE $3)" : ""}
    `;
    const countValues = [attributeId, organizationId, ...(search ? [`%${search}%`] : [])];
    const countResult = await pool.query(countQuery, countValues);
    const totalRows = Number(countResult.rows[0].count);
    const totalPages = Math.ceil(totalRows / pageSize);

    // fetch
    const query = `
      SELECT id, "attributeId", name, slug, "organizationId", "createdAt", "updatedAt"
      FROM "productAttributeTerms"
      WHERE "attributeId" = $1 AND "organizationId" = $2
      ${search ? "AND (name ILIKE $3 OR slug ILIKE $3)" : ""}
      ORDER BY "createdAt" DESC
      LIMIT $${countValues.length + 1} OFFSET $${countValues.length + 2}
    `;
    const values = [...countValues, pageSize, (page - 1) * pageSize];
    const result = await pool.query(query, values);

    return NextResponse.json({
      terms: result.rows,
      totalPages,
      currentPage: page,
    });
  } catch (error) {
    console.error("[GET /terms]", error);
    return NextResponse.json({ error: "Failed to fetch terms" }, { status: 500 });
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ attributeId: string }> }
) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { organizationId } = ctx;
  const { attributeId } = await params;

  try {
    const body = await req.json();
    const { name, slug } = termSchema.parse(body);
    // ensure unique slug under this attribute
    const slugCheck = await pool.query(
      `SELECT id FROM "productAttributeTerms"
       WHERE "attributeId" = $1 AND slug = $2 AND "organizationId" = $3`,
      [attributeId, slug, organizationId]
    );
    if (slugCheck.rows.length) {
      return NextResponse.json(
        { error: "Slug already exists for this attribute" },
        { status: 400 }
      );
    }
    const termId = uuidv4();
    const insert = await pool.query(
      `INSERT INTO "productAttributeTerms"
         (id, "attributeId", name, slug, "organizationId", "createdAt", "updatedAt")
       VALUES ($1,$2,$3,$4,$5,NOW(),NOW())
       RETURNING *`,
      [termId, attributeId, name, slug, organizationId]
    );
    return NextResponse.json(insert.rows[0], { status: 201 });
  } catch (err) {
    console.error("[POST /terms]", err);
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.errors }, { status: 400 });
    }
    return NextResponse.json({ error: "Failed to create term" }, { status: 500 });
  }
}

// ────────────────────────────────────────────────────────────────────
// DELETE /api/product-attributes/[attributeId]/terms → bulk delete
// ────────────────────────────────────────────────────────────────────
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ attributeId: string }> }
) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { organizationId } = ctx;
  const { attributeId } = await params;
  const { ids } = await req.json() as { ids: string[] };
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    // delete terms
    const del = await client.query(
      `DELETE FROM "productAttributeTerms"
       WHERE "attributeId" = $1
         AND id = ANY($2)
         AND "organizationId" = $3`,
      [attributeId, ids, organizationId]
    );
    await client.query("COMMIT");
    return NextResponse.json({ deletedCount: del.rowCount });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("[DELETE /terms]", err);
    return NextResponse.json(
      { error: "Failed to bulk-delete terms" },
      { status: 500 }
    );
  } finally {
    client.release();
  }
}
