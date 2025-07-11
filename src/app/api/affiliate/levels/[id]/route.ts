// src/app/api/affiliate/levels/[id]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { pgPool as pool } from "@/lib/db";;
import { getContext } from "@/lib/context";



/* ─────────────────── zod schema ─────────────────── */
const levelSchema = z.object({
  name: z.string().min(1).optional(),
  levelUpMessage: z.string().nullable().optional(),
  levelUpMessageGroup: z.string().nullable().optional(),
  requiredPoints: z.number().int().nonnegative().optional(),
});

/* ─────────────────── GET (single level) ─────────────────── */
export async function GET(
  req: NextRequest,
  context: { params: { id: string } }
) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { organizationId } = ctx;

  // ⬇️  params is async now
  const { id } = await context.params;

  const { rows } = await pool.query(
    `SELECT * FROM "affiliateLevels"
     WHERE id = $1 AND "organizationId" = $2`,
    [id, organizationId],
  );

  return rows.length
    ? NextResponse.json(rows[0])
    : NextResponse.json({ error: "Not found" }, { status: 404 });
}

/* ─────────────────── PATCH (update) ─────────────────── */
export async function PATCH(
  req: NextRequest,
  context: { params: { id: string } }
) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { organizationId } = ctx;

  const { id } = await context.params;

  const payload = levelSchema.parse(await req.json());
  if (Object.keys(payload).length === 0)
    return NextResponse.json({ error: "No fields" }, { status: 400 });

  // dynamic SET clause
  const sets: string[] = [];
  const values: any[] = [];
  let i = 1;
  for (const [k, v] of Object.entries(payload)) {
    sets.push(`"${k}" = $${i++}`);
    values.push(v);
  }
  values.push(id, organizationId); // for WHERE

  const { rows } = await pool.query(
    `
    UPDATE "affiliateLevels"
    SET ${sets.join(", ")}, "updatedAt" = NOW()
    WHERE id = $${i++} AND "organizationId" = $${i}
    RETURNING *
    `,
    values,
  );

  return rows.length
    ? NextResponse.json(rows[0])
    : NextResponse.json({ error: "Not found" }, { status: 404 });
}

/* ─────────────────── DELETE ─────────────────── */
export async function DELETE(
  req: NextRequest,
  context: { params: { id: string } }
) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { organizationId } = ctx;

  const { id } = await context.params;

  const { rows } = await pool.query(
    `DELETE FROM "affiliateLevels"
     WHERE id = $1 AND "organizationId" = $2
     RETURNING *`,
    [id, organizationId],
  );

  return rows.length
    ? NextResponse.json({ message: "Deleted" })
    : NextResponse.json({ error: "Not found" }, { status: 404 });
}
