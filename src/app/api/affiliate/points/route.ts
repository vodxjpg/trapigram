// app/api/affiliate/points/route.ts
/*─────────────────────────────────────────────────────────────────────
  /api/affiliate/points            (rewritten 2025-06-27)
  – persists logs (back-compat with legacy bot fields)
  – keeps running balances in affiliatePointBalances
  – GET now accepts `clientId` as an alias of `id` (client filter)
─────────────────────────────────────────────────────────────────────*/

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { pgPool as pool } from "@/lib/db";          /* ← unified pool */
import { v4 as uuidv4 } from "uuid";
import { getContext } from "@/lib/context";
import type { PoolClient } from "pg";               /* type only */

/*───────── validation ─────────*/
const createSchema = z.object({
  id: z.string().min(1),          // clientId
  points: z
  .number()
  .refine((n) => Number.isFinite(n) && Math.round(n * 10) === n * 10, {
    message: "points must have at most one decimal place",
  }),
  action: z.string().min(1),
  description: z.string().nullable().optional(),
  sourceId: z.string().nullable().optional(),
});

const querySchema = z.object({
  id: z.string().optional(),          // filter by clientId
  clientId: z.string().optional(),    // ← alias supported in GET
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(100).default(10),

  // Optional filters
  search: z.string().trim().optional(),                 // matches action/description/client names
  action: z.string().trim().optional(),                 // exact action
  direction: z.enum(["gains", "losses"]).optional(),    // points > 0 | < 0
  dateFrom: z.coerce.date().optional(),                 // ISO → Date
  dateTo: z.coerce.date().optional(),                   // ISO → Date
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

  // Parse query and support `clientId` as an alias of `id`
  const rawParams = Object.fromEntries(new URL(req.url).searchParams.entries());
  const qp = querySchema.parse({
    ...rawParams,
    id: rawParams.id ?? rawParams.clientId ?? undefined,
  });

  const {
    id,
    page,
    pageSize,
    search,
    action,
    direction,
    dateFrom,
    dateTo,
  } = qp;

  // Build WHERE with parameter indexing that stays consistent for count + select
  const vals: any[] = [organizationId];
  const where: string[] = [`apl."organizationId" = $1`];

  const push = (v: any) => {
    vals.push(v);
    return `$${vals.length}`;
  };

  if (id) {
    const p = push(id);
    where.push(`apl."clientId" = ${p}`);
  }

  if (action) {
    const p = push(action);
    where.push(`apl."action" = ${p}`);
  }

  if (direction === "gains") {
    where.push(`apl.points > 0`);
  } else if (direction === "losses") {
    where.push(`apl.points < 0`);
  }

  if (dateFrom) {
    const p = push(dateFrom);
    where.push(`apl."createdAt" >= ${p}`);
  }
  if (dateTo) {
    const p = push(dateTo);
    where.push(`apl."createdAt" <= ${p}`);
  }

  if (search && search.trim()) {
    const p = push(`%${search.trim()}%`);
    where.push(`(
      apl.action ILIKE ${p}
      OR apl.description ILIKE ${p}
      OR c.username ILIKE ${p}
      OR c."firstName" ILIKE ${p}
      OR c."lastName" ILIKE ${p}
      OR sc.username ILIKE ${p}
      OR sc."firstName" ILIKE ${p}
      OR sc."lastName" ILIKE ${p}
      OR apl."clientId"::text ILIKE ${p}
      OR apl."sourceClientId"::text ILIKE ${p}
    )`);
  }

  // COUNT with the same joins so search-by-client works in totals
  const countSql = `
    SELECT COUNT(*) FROM "affiliatePointLogs" apl
    LEFT JOIN clients c
      ON c.id = apl."clientId" AND c."organizationId" = apl."organizationId"
    LEFT JOIN clients sc
      ON sc.id = apl."sourceClientId" AND sc."organizationId" = apl."organizationId"
    WHERE ${where.join(" AND ")}
  `;
  const countRes = await pool.query(countSql, vals);
  const total = Number(countRes.rows?.[0]?.count ?? 0);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  // SELECT page
  const selectSql = `
    SELECT
      apl.id,
      apl."clientId",
      apl."organizationId",
      apl.points,
      apl.action,
      apl.description,
      apl."sourceClientId",
      apl."createdAt",
      apl."updatedAt",
      /* human label for clientId */
      COALESCE(
        NULLIF(c.username, ''),
        NULLIF(TRIM(COALESCE(c."firstName",'') || ' ' || COALESCE(c."lastName",'')), ''),
        NULLIF(c."userId", ''),
        apl."clientId"
      ) AS "clientLabel",
      /* human label for sourceClientId */
      COALESCE(
        NULLIF(sc.username, ''),
        NULLIF(TRIM(COALESCE(sc."firstName",'') || ' ' || COALESCE(sc."lastName",'')), ''),
        NULLIF(sc."userId", ''),
        apl."sourceClientId"
      ) AS "sourceClientLabel"
    FROM "affiliatePointLogs" apl
    LEFT JOIN clients c
      ON c.id = apl."clientId" AND c."organizationId" = apl."organizationId"
    LEFT JOIN clients sc
      ON sc.id = apl."sourceClientId" AND sc."organizationId" = apl."organizationId"
    WHERE ${where.join(" AND ")}
    ORDER BY apl."createdAt" DESC
    LIMIT $${vals.length + 1} OFFSET $${vals.length + 2}
  `;
  const { rows } = await pool.query(selectSql, [...vals, pageSize, (page - 1) * pageSize]);

  return NextResponse.json({ logs: rows, totalPages, currentPage: page });
}

/*────────────────────────────── POST – create + balance ───────────*/
export async function POST(req: NextRequest) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { organizationId } = ctx;

  /* ── legacy field normalisation BEFORE schema parsing ───────────*/
  const raw = await req.json();
  if (raw.clientId && !raw.id) raw.id = raw.clientId;
  if (raw.reason && !raw.action) {
    raw.action = ({
      referral: "referral_bonus",
      review: "review_bonus",
      spending: "spending_bonus",
      group: "group_join",
    } as Record<string, string>)[raw.reason] ?? raw.reason;
  }
  if (!raw.description) {
    raw.description = ({
      review_bonus: "Review bonus",
      referral_bonus: "Referral bonus",
      spending_bonus: "Spending bonus",
      group_join: "Group-join bonus",
    } as Record<string, string>)[raw.action] ?? null;
  }

  try {
    const payload = createSchema.parse(raw);
    const logId = uuidv4();

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
