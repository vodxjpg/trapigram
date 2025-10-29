import { NextRequest, NextResponse } from "next/server";
import { sql } from "kysely";
import { db } from "@/lib/db";
import { getContext } from "@/lib/context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST body:
//   { scope: 'all' }
//   { scope: 'subset', clientIds: string[] }
export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> } // Next 16
) {
  const { id: ruleId } = await context.params;

  const ctxOr = await getContext(req);
  if (ctxOr instanceof NextResponse) return ctxOr;
  const { organizationId } = ctxOr;

  // Verify the rule belongs to this org (prevents cross-tenant resets)
  const ruleCheck = await sql`
    SELECT 1
    FROM "automationRules"
    WHERE id = ${ruleId} AND "organizationId" = ${organizationId}
    LIMIT 1
  `.execute(db);
  if (ruleCheck.rows.length === 0) {
    return NextResponse.json({ error: "Rule not found" }, { status: 404 });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const scope: "all" | "subset" = body?.scope === "subset" ? "subset" : "all";
    const clientIds: string[] = Array.isArray(body?.clientIds) ? body.clientIds : [];

    if (scope === "all") {
      await sql`
        UPDATE "ruleEngagement"
        SET "lockUntil" = NULL
        WHERE "organizationId" = ${organizationId}
          AND "ruleId" = ${ruleId}
      `.execute(db);
    } else {
      if (clientIds.length === 0) {
        return NextResponse.json({ error: "clientIds required for subset" }, { status: 400 });
      }
      await sql`
        UPDATE "ruleEngagement"
        SET "lockUntil" = NULL
        WHERE "organizationId" = ${organizationId}
          AND "ruleId" = ${ruleId}
          AND "clientId" IN (${sql.join(clientIds)})
      `.execute(db);
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[rules/:id/actions/reset-locks]", e);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
