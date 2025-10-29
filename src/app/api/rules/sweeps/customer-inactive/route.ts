// /src/app/api/rules/sweeps/customer-inactive/route.ts

import { NextResponse } from "next/server";
import { sql } from "kysely";
import { db } from "@/lib/db";
import { executeCustomerInactive } from "@/lib/rules/execute";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// read cooldown; default 30
function readCooldownDays(payload: any): number {
  const cd = Number(payload?.cooldownDays);
  return Number.isFinite(cd) && cd > 0 ? Math.floor(cd) : 30;
}

export async function GET() {
  try {
    // Load enabled customer_inactive rules with payload
    const rulesRes = await sql`
      SELECT r."organizationId", r.id as "ruleId", r.payload
      FROM "automationRules" r
      WHERE r.enabled = true
        AND r.event = 'customer_inactive'
    `.execute(db);

    type RuleRow = { organizationId: string; ruleId: string; payload: any };
    const rules = (rulesRes.rows as RuleRow[]).map((r) => ({
      organizationId: r.organizationId,
      ruleId: r.ruleId,
      payload:
        typeof r.payload === "string" ? JSON.parse(r.payload || "{}") : r.payload ?? {},
    }));

    if (rules.length === 0) {
      return NextResponse.json({ ok: true, checked: 0, triggered: 0, reason: "no_rules" });
    }

    let totalChecked = 0;
    let totalTriggered = 0;
    const perRuleResults: Array<{
      organizationId: string;
      ruleId: string;
      thresholdDays: number;
      candidates: number;
      triggered: number;
    }> = [];

    // Process each rule separately → per-rule cooldown lock
    for (const r of rules) {
      const items = r.payload?.conditions?.items ?? [];
      const noOrder = items.find((i: any) => i?.kind === "no_order_days_gte");
      const days = Math.max(1, Math.floor(Number(noOrder?.days || 0)));
      if (!Number.isFinite(days) || days <= 0) continue;

      const cooldown = readCooldownDays(r.payload);

      // Find clients who are inactive beyond threshold and not locked for THIS rule
      const candRes = await sql`
        SELECT c.id as "clientId"
        FROM "clients" c
        LEFT JOIN "ruleEngagement" re
          ON re."organizationId" = c."organizationId"
         AND re."ruleId" = ${r.ruleId}
         AND re."clientId" = c.id
        WHERE c."organizationId" = ${r.organizationId}
          AND c."lastInteraction" < (NOW() - make_interval(days => ${days}))
          AND (re."lockUntil" IS NULL OR re."lockUntil" < NOW())
        LIMIT 500
      `.execute(db);

      const clientIds = (candRes.rows as Array<{ clientId: string }>).map((x) => x.clientId);
      totalChecked += clientIds.length;

      if (clientIds.length === 0) {
        perRuleResults.push({
          organizationId: r.organizationId,
          ruleId: r.ruleId,
          thresholdDays: days,
          candidates: 0,
          triggered: 0,
        });
        continue;
      }

      let ruleTriggered = 0;
      for (const clientId of clientIds) {
        // Execute dispatcher for THIS rule
        await executeCustomerInactive({
          organizationId: r.organizationId,
          clientId,
          matchedRuleIds: [r.ruleId],
        });

        // Upsert THIS rule's lock for THIS client
        await sql`
          INSERT INTO "ruleEngagement"
            ("organizationId","ruleId","clientId",
             "lockUntil","lastSentAt","inactiveSweepAt","createdAt","updatedAt")
          VALUES
            (${r.organizationId}, ${r.ruleId}, ${clientId},
             NOW() + make_interval(days => ${cooldown}), NOW(), NOW(), NOW(), NOW())
          ON CONFLICT ("organizationId","ruleId","clientId") DO UPDATE
             SET "lockUntil"       = EXCLUDED."lockUntil",
                 "lastSentAt"      = EXCLUDED."lastSentAt",
                 "inactiveSweepAt" = EXCLUDED."inactiveSweepAt",
                 "updatedAt"       = NOW()
        `.execute(db);

        ruleTriggered += 1;
      }

      totalTriggered += ruleTriggered;
      perRuleResults.push({
        organizationId: r.organizationId,
        ruleId: r.ruleId,
        thresholdDays: days,
        candidates: clientIds.length,
        triggered: ruleTriggered,
      });
    }

    return NextResponse.json({
      ok: true,
      checked: totalChecked,
      triggered: totalTriggered,
      perRuleResults,
    });
  } catch (e) {
    console.error("[customer-inactive-sweep per-rule]", e);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
