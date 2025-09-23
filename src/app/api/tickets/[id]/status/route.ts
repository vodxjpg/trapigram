// src/app/api/tickets/[id]/status/route.ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { pgPool as pool } from "@/lib/db";
import { getContext } from "@/lib/context";



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

const statusTicketSchema = z.object({
  status: z.enum(["open", "in-progress", "closed"])
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { organizationId } = ctx;


  // parse & validate JSON
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const { status } = statusTicketSchema.parse(body);

  // get the ticket ID
  const { id } = await params;

  // perform update
  const updateQuery = `
    UPDATE tickets
       SET status = $1,
           "updatedAt" = NOW()
     WHERE id = $2
       AND "organizationId" = $3
    RETURNING *;
  `;
  const { rows } = await pool.query(updateQuery, [status, id, organizationId]);
  if (rows.length === 0) {
    return NextResponse.json({ error: "Ticket not found" }, { status: 404 });
  }

  return NextResponse.json(rows[0], { status: 200 });
}
