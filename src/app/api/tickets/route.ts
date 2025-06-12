// src/app/api/tickets/route.ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Pool } from "pg";
import { v4 as uuidv4 } from "uuid";
import { getContext } from "@/lib/context";
import { requirePermission } from "@/lib/perm-server";
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// helper to check if caller is owner
async function isOwner(organizationId: string, userId: string) {
  const { rowCount } = await pool.query(
    `SELECT 1 FROM member
     WHERE "organizationId" = $1
       AND "userId"        = $2
       AND role            = 'owner'
     LIMIT 1`,
    [organizationId, userId]
  );
  return rowCount > 0;
}

const ticketSchema = z.object({
  title: z.string().min(1, "Title is required"),
  clientId: z.string().uuid(),
  priority: z.enum(["low", "medium", "high"]).default("medium"),
  status:   z.enum(["open", "in-progress", "closed"]).default("open"),
});

export async function GET(req: NextRequest) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { organizationId, userId } = ctx;

  // only check permission for non-owners
  if (!(await isOwner(organizationId, userId))) {
    const guard = await requirePermission(req, { ticket: ["view"] });
    if (guard) return guard;
  }

  try {
    const { searchParams } = new URL(req.url);
    const page     = Number(searchParams.get("page"))     || 1;
    const pageSize = Number(searchParams.get("pageSize")) || 10;
    const search   = searchParams.get("search")           || "";

    // build count + list queries as before...
    let countQuery = `SELECT COUNT(*) FROM tickets WHERE "organizationId" = $1`;
    const countVals: any[] = [organizationId];

    let query = `
      SELECT id, "organizationId","clientId",title,priority,status,"createdAt","updatedAt"
      FROM tickets
      WHERE "organizationId" = $1
    `;
    const vals: any[] = [organizationId];

    if (search) {
      countQuery += ` AND title ILIKE $2`;
      query      += ` AND title ILIKE $2`;
      countVals.push(`%${search}%`);
      vals.push(`%${search}%`);
    }

    query += ` ORDER BY "createdAt" DESC
               LIMIT $${vals.length+1}
               OFFSET $${vals.length+2}`;
    vals.push(pageSize, (page - 1) * pageSize);

    const totalRows  = Number((await pool.query(countQuery, countVals)).rows[0].count);
    const totalPages = Math.ceil(totalRows / pageSize);
    const tickets    = (await pool.query(query, vals)).rows;

    return NextResponse.json({ tickets, totalPages, currentPage: page });
  } catch (err) {
    console.error("[GET /api/tickets]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { organizationId, userId } = ctx;

  // owner bypass for create
  if (!(await isOwner(organizationId, userId))) {
    const guard = await requirePermission(req, { ticket: ["create"] });
    if (guard) return guard;
  }

  try {
    const data = ticketSchema.parse(await req.json());
    const ticketId = uuidv4();
    const insert = `
      INSERT INTO tickets
        (id,"organizationId","clientId",title,priority,status,"createdAt","updatedAt")
      VALUES ($1,$2,$3,$4,$5,$6,NOW(),NOW())
      RETURNING *;
    `;
    const vals = [ticketId, organizationId, data.clientId, data.title, data.priority, data.status];
    const result = (await pool.query(insert, vals)).rows[0];
    return NextResponse.json(result, { status: 201 });
  } catch (err: any) {
    console.error("[POST /api/tickets]", err);
    if (err instanceof z.ZodError)
      return NextResponse.json({ error: err.errors }, { status: 400 });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
