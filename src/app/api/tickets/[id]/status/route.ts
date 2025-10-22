// src/app/api/tickets/[id]/status/route.ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { pgPool as pool } from "@/lib/db";
import { getContext } from "@/lib/context";

export const runtime = "nodejs";

const statusTicketSchema = z.object({
  status: z.enum(["open", "in-progress", "closed"]),
  reopen: z.boolean().optional(),
});

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> } // Next 16: params is async
) {
  const { id } = await context.params;

  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { organizationId } = ctx;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = statusTicketSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { status, reopen } = parsed.data;

  const updateQuery = `
    UPDATE tickets
       SET status = $1,
           "updatedAt" = NOW(),
           "lastMessageAt" = CASE WHEN $4 THEN NOW() ELSE "lastMessageAt" END
     WHERE id = $2
       AND "organizationId" = $3
    RETURNING *;
  `;

  const { rows } = await pool.query(updateQuery, [
    status,
    id,
    organizationId,
    Boolean(reopen),
  ]);

  if (!rows.length) {
    return NextResponse.json({ error: "Ticket not found" }, { status: 404 });
  }

  return NextResponse.json(rows[0], { status: 200 });
}
