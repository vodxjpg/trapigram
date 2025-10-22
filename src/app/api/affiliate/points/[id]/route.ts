// src/app/api/affiliate/points/[id]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { pgPool as pool } from "@/lib/db";
import { getContext } from "@/lib/context";
import type { Pool, PoolClient } from "pg";

const logUpdateSchema = z.object({
  points: z
    .number()
    .refine((n) => Math.round(n * 10) === n * 10, "Max one decimal place")
    .optional(),
  action: z.string().optional(),
  description: z.string().optional().nullable(),
});

/*──────── helper – balance delta ────────*/
async function applyBalanceDelta(
  clientId: string,
  organizationId: string,
  deltaCurrent: number,
  deltaSpent: number,
  client: Pool | PoolClient,
) {
  await client.query(
    `
    INSERT INTO "affiliatePointBalances"(
      "clientId","organizationId","pointsCurrent","pointsSpent","createdAt","updatedAt"
    )
    VALUES($1,$2,$3,$4,NOW(),NOW())
    ON CONFLICT("clientId","organizationId") DO UPDATE
      SET "pointsCurrent" = "affiliatePointBalances"."pointsCurrent" + EXCLUDED."pointsCurrent",
          "pointsSpent"   = "affiliatePointBalances"."pointsSpent"   + EXCLUDED."pointsSpent",
          "updatedAt"     = NOW()
    `,
    [clientId, organizationId, deltaCurrent, deltaSpent],
  );
}

/*──────── GET ────────*/
export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }, // Next 16: Promise
) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { organizationId } = ctx;

  const { id } = await context.params;

  const { rows } = await pool.query(
    `SELECT * FROM "affiliatePointLogs" WHERE id = $1 AND "organizationId" = $2`,
    [id, organizationId],
  );
  if (rows.length === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json(rows[0]);
}

/*──────── PATCH ────────*/
export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }, // Next 16: Promise
) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { organizationId } = ctx;

  const { id } = await context.params;

  try {
    const parsed = logUpdateSchema.parse(await req.json());
    if (Object.keys(parsed).length === 0) {
      return NextResponse.json({ error: "No fields provided" }, { status: 400 });
    }

    // start tx
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // pull old row
      const { rows: oldRows } = await client.query(
        `SELECT * FROM "affiliatePointLogs" WHERE id = $1 AND "organizationId" = $2`,
        [id, organizationId],
      );
      if (oldRows.length === 0) {
        await client.query("ROLLBACK");
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }
      const old = oldRows[0];

      // build SET clause
      const sets: string[] = [];
      const vals: any[] = [];
      let i = 1;
      for (const [k, v] of Object.entries(parsed)) {
        if (v !== undefined) {
          sets.push(`"${k}" = $${i++}`);
          vals.push(v);
        }
      }
      vals.push(id, organizationId);

      const { rows } = await client.query(
        `
        UPDATE "affiliatePointLogs"
        SET ${sets.join(", ")}, "updatedAt" = NOW()
        WHERE id = $${i++} AND "organizationId" = $${i}
        RETURNING *
        `,
        vals,
      );
      const updated = rows[0];

      // compute deltas
      const oldCurrent = old.points;
      const oldSpent = old.points < 0 ? Math.abs(old.points) : 0;
      const newCurrent = updated.points;
      const newSpent = updated.points < 0 ? Math.abs(updated.points) : 0;

      const deltaCurrent = newCurrent - oldCurrent;
      const deltaSpent = newSpent - oldSpent;

      await applyBalanceDelta(updated.clientId, organizationId, deltaCurrent, deltaSpent, client);

      await client.query("COMMIT");
      return NextResponse.json(updated);
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  } catch (e: any) {
    console.error(e);
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: e.errors }, { status: 400 });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/*──────── DELETE ────────*/
export async function DELETE(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }, // Next 16: Promise
) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { organizationId } = ctx;

  const { id } = await context.params;

  // start tx
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { rows: oldRows } = await client.query(
      `DELETE FROM "affiliatePointLogs" WHERE id = $1 AND "organizationId" = $2 RETURNING *`,
      [id, organizationId],
    );
    if (oldRows.length === 0) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const old = oldRows[0];

    const deltaCurrent = -old.points;
    const deltaSpent = old.points < 0 ? -Math.abs(old.points) : 0;

    await applyBalanceDelta(old.clientId, organizationId, deltaCurrent, deltaSpent, client);

    await client.query("COMMIT");
    return NextResponse.json({ message: "Deleted" });
  } catch (e) {
    await client.query("ROLLBACK");
    console.error(e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  } finally {
    client.release();
  }
}
