// src/app/api/tickets/[id]/tags/route.ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Pool } from "pg";
import { v4 as uuidv4 } from "uuid";
import { getContext } from "@/lib/context";
import { requireOrgPermission } from "@/lib/perm-server";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

/** Helper to check if the caller is the org owner */
async function isOwner(organizationId: string, userId: string) {
  const { rowCount } = await pool.query(
    `SELECT 1
       FROM member
      WHERE "organizationId" = $1
        AND "userId"        = $2
        AND role            = 'owner'
      LIMIT 1`,
    [organizationId, userId]
  );
  return rowCount > 0;
}

// Body schema for POST
const tagListSchema = z.object({
  tags: z.array(z.string().min(1, "Tag cannot be empty")),
});

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // 1) context + view guard
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { organizationId, userId } = ctx;

  if (!(await isOwner(organizationId, userId))) {
    const guard = await requireOrgPermission(req, { ticket: ["view"] });
    if (guard) {
      return NextResponse.json(
        { error: "You don’t have permission to view tags" },
        { status: 403 }
      );
    }
  }

  try {
    const { id } = await params;
    // fetch assigned tags
    const tagsRes = await pool.query(
      `SELECT t.description
         FROM tags AS t
         JOIN "ticketTags" AS tt
           ON tt."tagId" = t.id
        WHERE tt."ticketId" = $1`,
      [id]
    );
    // fetch all possible tags
    const allRes = await pool.query(`SELECT description FROM tags`);
    return NextResponse.json(
      { tags: tagsRes.rows, tagList: allRes.rows },
      { status: 200 }
    );
  } catch (err) {
    console.error("[GET /api/tickets/:id/tags]", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // 1) context + update guard
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { organizationId, userId } = ctx;

  if (!(await isOwner(organizationId, userId))) {
    const guard = await requireOrgPermission(req, { ticket: ["update"] });
    if (guard) {
      return NextResponse.json(
        { error: "You don’t have permission to update tags" },
        { status: 403 }
      );
    }
  }

  // 2) parse & validate body
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parse = tagListSchema.safeParse(body);
  if (!parse.success) {
    return NextResponse.json(
      { error: parse.error.errors.map((e) => e.message).join(", ") },
      { status: 400 }
    );
  }
  const { tags } = parse.data;
  const { id } = await params;

  // 3) update ticketTags in a transaction
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // remove existing
    await client.query(
      `DELETE FROM "ticketTags" WHERE "ticketId" = $1`,
      [id]
    );

    for (const description of tags) {
      // ensure tag exists
      const tagRes = await client.query(
        `SELECT id FROM tags WHERE description = $1`,
        [description]
      );
      let tagId: string;
      if (tagRes.rowCount) {
        tagId = tagRes.rows[0].id;
      } else {
        tagId = uuidv4();
        await client.query(
          `INSERT INTO tags(id, description, "createdAt", "updatedAt")
           VALUES($1, $2, NOW(), NOW())`,
          [tagId, description]
        );
      }
      // link
      await client.query(
        `INSERT INTO "ticketTags"(id, "ticketId", "tagId", "createdAt", "updatedAt")
         VALUES($1, $2, $3, NOW(), NOW())`,
        [uuidv4(), id, tagId]
      );
    }

    await client.query("COMMIT");
    return NextResponse.json({ status: 201 });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("[POST /api/tickets/:id/tags]", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  } finally {
    client.release();
  }
}
