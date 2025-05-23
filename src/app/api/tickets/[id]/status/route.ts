import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Pool } from "pg";
import { getContext } from "@/lib/context";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const statusTicketSchema = z.object({ status: z.string() });

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;

  // 1) parse & validate JSON
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const { status } = statusTicketSchema.parse(body);

  // 2) get the id
  const { id } = await params;

  // 3) run the update
  const updateQuery = `
    UPDATE "tickets"
    SET status = $1
    WHERE id = $2
    RETURNING *
  `;
  const { rows } = await pool.query(updateQuery, [status, id]);
  if (rows.length === 0) {
    return NextResponse.json({ error: "Ticket not found" }, { status: 404 });
  }

  return NextResponse.json(rows[0], { status: 200 });
}
