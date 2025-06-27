// src/app/api/tickets/[id]/priority/route.ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { pgPool as pool } from "@/lib/db";;
import { getContext } from "@/lib/context";
import { requireOrgPermission } from "@/lib/perm-server";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

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

const priorityTicketSchema = z.object({
  priority: z.enum(["low", "medium", "high"])
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // 1) Context & ownership check
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { organizationId, userId } = ctx;

  if (!(await isOwner(organizationId, userId))) {
    const guard = await requireOrgPermission(req, { ticket: ["update"] });
    if (guard) {
      // return a clear 403 with message for the frontend toast
      return NextResponse.json({ error: "You don’t have permission to change ticket priority" }, { status: 403 });
    }
  }

  // 2) Extract & validate
  const { id } = await params;
  const rawPriority = req.headers.get("x-priority");
  const parseResult = priorityTicketSchema.safeParse({ priority: rawPriority });
  if (!parseResult.success) {
    return NextResponse.json({ error: "Invalid priority value" }, { status: 400 });
  }
  const { priority } = parseResult.data;

  // 3) Perform the update (scope to this org)
  try {
    const updateQuery = `
      UPDATE tickets
         SET priority  = $1,
             "updatedAt" = NOW()
       WHERE id             = $2
         AND "organizationId" = $3
       RETURNING *;
    `;
    const { rows } = await pool.query(updateQuery, [priority, id, organizationId]);
    if (rows.length === 0) {
      return NextResponse.json({ error: "Ticket not found" }, { status: 404 });
    }
    return NextResponse.json(rows[0], { status: 200 });
  } catch (err) {
    console.error("[PATCH /api/tickets/[id]/priority]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
