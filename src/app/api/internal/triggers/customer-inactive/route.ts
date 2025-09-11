// src/app/api/internal/triggers/customer-inactive/route.ts
import { NextRequest, NextResponse } from "next/server";
import { pgPool as pool } from "@/lib/db";
import { processAutomationRules } from "@/lib/rules";

export const runtime = "nodejs";
export const preferredRegion = ["iad1"];

/**
 * This endpoint finds clients who have **not** placed a paid/completed order
 * in the last `days` days (or have never ordered) and fires the
 * `customer_inactive` trigger for matching organizations.
 *
 * Auth:
 *  - Internal: send `x-internal-secret: <INTERNAL_API_SECRET>`
 *  - Vercel Cron: request carries `x-vercel-cron` header automatically
 *
 * Query params:
 *  - organizationId? : string (optional; if omitted we auto-discover all orgs that
 *                      have an enabled automation rule with event='customer_inactive')
 *  - days?           : number (default 30)
 *  - limit?          : number (default 500; 1..1000 clamp)
 */

async function handle(req: NextRequest) {
  const secret = req.headers.get("x-internal-secret");
  const isVercelCron = !!req.headers.get("x-vercel-cron");
  if (!isVercelCron && (!secret || secret !== process.env.INTERNAL_API_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const organizationId = url.searchParams.get("organizationId");
  const days = Math.max(0, Number(url.searchParams.get("days") || 30));
  const limit = Math.max(1, Math.min(1000, Number(url.searchParams.get("limit") || 500)));

  async function runForOrg(orgId: string) {
    // Find clients that either never had a paid/completed order or whose last
    // paid/completed timestamp is older than N days.
    const { rows } = await pool.query(
      `
      WITH last_orders AS (
        SELECT
          c.id AS "clientId",
          c.country AS country,
          -- last timestamp across paid/completed lifecycle columns
          GREATEST(
            COALESCE(MAX(CASE WHEN o.status IN ('paid','completed') THEN o."datePaid" END),       to_timestamp(0)),
            COALESCE(MAX(CASE WHEN o.status IN ('paid','completed') THEN o."dateCompleted" END), to_timestamp(0)),
            COALESCE(MAX(CASE WHEN o.status IN ('paid','completed') THEN o."dateCreated" END),   to_timestamp(0))
          ) AS last_ts,
          BOOL_OR(o.status IN ('paid','completed')) AS has_any
        FROM clients c
        LEFT JOIN orders o
          ON o."clientId" = c.id
         AND o."organizationId" = $1
        WHERE c."organizationId" = $1
        GROUP BY c.id, c.country
      )
      SELECT "clientId", country, last_ts, has_any
      FROM last_orders
      WHERE
        -- never ordered → always inactive when days >= 1 (or immediately if days == 0)
        (has_any = FALSE AND $2::int >= 0)
        OR
        -- ordered before, but last paid/completed is older than N days
        (has_any = TRUE  AND EXTRACT(EPOCH FROM (NOW() - last_ts)) / 86400 >= $2::int)
      LIMIT $3
      `,
      [orgId, days, limit],
    );

    let fired = 0;
    for (const r of rows) {
      await processAutomationRules({
        organizationId: orgId,
        event: "customer_inactive" as any, // ensure your events enum includes this
        country: r.country ?? null,
        clientId: r.clientId,
        userId: null,
        orderId: null,
        url: null,
        variables: { inactive_days: String(days) },
      });
      fired++;
    }
    return { candidates: rows.length, fired };
  }

  if (organizationId) {
    const res = await runForOrg(organizationId);
    return NextResponse.json({
      scope: "single_org",
      organizationId,
      days,
      limit,
      ...res,
    });
  }

  // Auto-discover orgs that actually use this trigger
  const { rows: orgs } = await pool.query(
    `SELECT DISTINCT "organizationId" AS id
       FROM "automationRules"
      WHERE event = 'customer_inactive' AND enabled = TRUE`
  );

  const results: Record<string, { candidates: number; fired: number }> = {};
  for (const o of orgs) {
    results[o.id] = await runForOrg(o.id);
  }

  return NextResponse.json({
    scope: "all_orgs_with_rule",
    organizations: Object.keys(results).length,
    days,
    limit,
    results,
  });
}

export async function GET(req: NextRequest) {
  return handle(req);
}
export async function POST(req: NextRequest) {
  return handle(req);
}
