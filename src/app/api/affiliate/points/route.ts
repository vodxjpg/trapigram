/*─────────────────────────────────────────────────────────────────────
  /api/affiliate/points            (rewritten 2025-06-27)
  – persists logs (back-compat with legacy bot fields)
  – keeps running balances in affiliatePointBalances
─────────────────────────────────────────────────────────────────────*/

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { pgPool as pool } from "@/lib/db";          /* ← unified pool */
import { v4 as uuidv4 } from "uuid";
import { getContext } from "@/lib/context";
import type { PoolClient } from "pg";               /* type only */

/*───────── validation ─────────*/
const createSchema = z.object({
  id:          z.string().min(1),          // clientId
  points:      z.number().int(),
  action:      z.string().min(1),
  description: z.string().nullable().optional(),
  sourceId:    z.string().nullable().optional(),
});

const querySchema = z.object({
  id:       z.string().optional(),
  page:     z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(100).default(10),
});

/*───────── helper – balance upsert ─────────*/
async function applyBalanceDelta(
  clientId: string,
  organizationId: string,
  deltaCurrent: number,
  deltaSpent: number,
  client: PoolClient,
) {
  await client.query(
    `
    INSERT INTO "affiliatePointBalances"(
      "clientId","organizationId","pointsCurrent","pointsSpent",
      "createdAt","updatedAt"
    )
    VALUES($1,$2,$3,$4,NOW(),NOW())
    ON CONFLICT("clientId","organizationId") DO UPDATE SET
      "pointsCurrent" = "affiliatePointBalances"."pointsCurrent" + EXCLUDED."pointsCurrent",
      "pointsSpent"   = "affiliatePointBalances"."pointsSpent"   + EXCLUDED."pointsSpent",
      "updatedAt"     = NOW()
    `,
    [clientId, organizationId, deltaCurrent, deltaSpent],
  );
}

/*────────────────────────────── GET – paginated history ───────────*/
export async function GET(req: NextRequest) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { organizationId } = ctx;

  const qp              = querySchema.parse(
    Object.fromEntries(new URL(req.url).searchParams.entries()),
  );
  const { id, page, pageSize } = qp;

  const where: string[] = [`"organizationId" = $1`];
  const vals: any[]     = [organizationId];
  if (id) { where.push(`"clientId" = $2`); vals.push(id); }

  const [{ count }] = (
    await pool.query(
      `SELECT COUNT(*) FROM "affiliatePointLogs" WHERE ${where.join(" AND ")}`,
      vals,
    )
  ).rows;
  const totalPages = Math.max(1, Math.ceil(Number(count) / pageSize));

  const { rows } = await pool.query(
    `
    SELECT id,"clientId","organizationId",points,action,description,
           "sourceClientId","createdAt","updatedAt"
      FROM "affiliatePointLogs"
     WHERE ${where.join(" AND ")}
     ORDER BY "createdAt" DESC
     LIMIT $${vals.length + 1} OFFSET $${vals.length + 2}
    `,
    [...vals, pageSize, (page - 1) * pageSize],
  );

  return NextResponse.json({ logs: rows, totalPages, currentPage: page });
}

/*────────────────────────────── POST – create + balance ───────────*/
export async function POST(req: NextRequest) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { organizationId } = ctx;

  /* ── legacy field normalisation BEFORE schema parsing ───────────*/
  const raw = await req.json();
  if (raw.clientId && !raw.id)  raw.id = raw.clientId;
  if (raw.reason   && !raw.action) {
    raw.action = ({
      referral:  "referral_bonus",
      review:    "review_bonus",
      spending:  "spending_bonus",
      group:     "group_join",
    } as Record<string,string>)[raw.reason] ?? raw.reason;
  }
  if (!raw.description) {
    raw.description = ({
      review_bonus:   "Review bonus",
      referral_bonus: "Referral bonus",
      spending_bonus: "Spending bonus",
      group_join:     "Group-join bonus",
    } as Record<string,string>)[raw.action] ?? null;
  }

  try {
    const payload = createSchema.parse(raw);
    const logId   = uuidv4();

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const { rows } = await client.query(
        `
        INSERT INTO "affiliatePointLogs"(
          id,"organizationId","clientId",points,action,description,"sourceClientId",
          "createdAt","updatedAt"
        )
        VALUES($1,$2,$3,$4,$5,$6,$7,NOW(),NOW())
        RETURNING *
        `,
        [
          logId,
          organizationId,
          payload.id,
          payload.points,
          payload.action,
          payload.description,
          payload.sourceId ?? null,
        ],
      );

      /* update running balance */
      await applyBalanceDelta(
        payload.id,
        organizationId,
        payload.points,
        payload.points < 0 ? Math.abs(payload.points) : 0,
        client,
      );

      await client.query("COMMIT");
      return NextResponse.json(rows[0], { status: 201 });
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  } catch (e: any) {
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: e.errors }, { status: 400 });
    }
    console.error("[POST /affiliate/points]", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
