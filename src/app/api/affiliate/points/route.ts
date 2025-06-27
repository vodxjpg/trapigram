/* ──────────────────────────────────────────────────────────────
 * /api/affiliate/points
 *  – keeps backward-compat with old bot payloads
 *  – always writes a readable description
 *  – updates affiliatePointBalances (current + spent)
 * ──────────────────────────────────────────────────────────── */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Pool, PoolClient } from "pg";
import { v4 as uuidv4 } from "uuid";
import { getContext } from "@/lib/context";



/*──────── validation ────────*/
const createSchema = z.object({
  id: z.string().min(1),                 // clientId
  points: z.number().int(),
  action: z.string().min(1),
  description: z.string().nullable().optional(),
  sourceId: z.string().nullable().optional(),
});
const querySchema = z.object({
  id: z.string().optional(),
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(100).default(10),
});

/*──────── helper – balance upsert ────────*/
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

/*──────── GET – paginated history ────────*/
export async function GET(req: NextRequest) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { organizationId } = ctx;

  const qp = querySchema.parse(Object.fromEntries(new URL(req.url).searchParams.entries()));
  const { id, page, pageSize } = qp;

  const where: string[] = [`"organizationId" = $1`];
  const vals: any[] = [organizationId];
  if (id) {
    where.push(`"clientId" = $2`);
    vals.push(id);
  }

  const [{ count }] = (
    await pool.query(`SELECT COUNT(*) FROM "affiliatePointLogs" WHERE ${where.join(" AND ")}`, vals)
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

/*──────── POST – create a log entry + update balance ────────*/
export async function POST(req: NextRequest) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { organizationId } = ctx;

  /* normalise legacy field-names BEFORE validation */
  const raw = await req.json();
  if (raw.clientId && !raw.id)   raw.id = raw.clientId;
  if (raw.reason   && !raw.action) {
    /* map old “reason” enum → new action string */
    const map: Record<string, string> = {
      referral: "referral_bonus",
      review:   "review_bonus",
      spending: "spending_bonus",
      group:    "group_join",
    };
    raw.action = map[raw.reason] ?? raw.reason;
  }

  /* fallback: make sure we always have some description */
  if (!raw.description) {
    const defaults: Record<string, string> = {
      review_bonus:    "Review bonus",
      referral_bonus:  "Referral bonus",
      spending_bonus:  "Spending bonus",
      group_join:      "Group-join bonus",
    };
    raw.description = defaults[raw.action] ?? null;
  }

  try {
    const payload = createSchema.parse(raw);
    const logId = uuidv4();

    /* ───── transaction ───── */
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

      /* update running balance ------------------------------------ */
      const deltaCurrent = payload.points;
      const deltaSpent   = payload.points < 0 ? Math.abs(payload.points) : 0;
      await applyBalanceDelta(payload.id, organizationId, deltaCurrent, deltaSpent, client);

      await client.query("COMMIT");
      return NextResponse.json(rows[0], { status: 201 });
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
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
