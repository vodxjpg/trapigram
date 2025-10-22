// src/app/api/organizations/[identifier]/billing/route.ts
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sql } from "kysely";
import { getContext } from "@/lib/context";

// GET /api/organizations/[identifier]/billing
export async function GET(
  req: NextRequest,
  context: { params: Promise<{ identifier: string }> } // Next 16
) {
  const { identifier } = await context.params;

  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { organizationId } = ctx;

  // Guard that the path org matches the caller's org
  if (identifier !== organizationId) {
    return NextResponse.json(
      { blocked: false, reason: "org_mismatch" },
      { status: 403 }
    );
  }

  // Resolve the owner of this organization
  const owner = await db
    .selectFrom("member")
    .select(["userId"])
    .where("organizationId", "=", organizationId)
    .where("role", "=", "owner")
    .executeTakeFirst();

  if (!owner?.userId) {
    return NextResponse.json({ blocked: false, reason: "org_or_owner_not_found" });
  }

  // Count invoices that should block the bot
  const PENDING_STATES = ["pending", "underpaid", "overdue", "unpaid"] as const;

  const cntRow = await db
    .selectFrom("userInvoices")
    .select(sql<number>`count(*)`.as("count"))
    .where("userId", "=", owner.userId)
    .where("status", "in", PENDING_STATES as unknown as string[]) // Kysely tuple cast
    .executeTakeFirst();

  const pendingCount = Number(cntRow?.count ?? 0);

  const latest = await db
    .selectFrom("userInvoices")
    .select(["id", "status", "dueDate"])
    .where("userId", "=", owner.userId)
    .where("status", "in", PENDING_STATES as unknown as string[])
    .orderBy("dueDate", "desc")
    .limit(1)
    .executeTakeFirst();

  return NextResponse.json({
    blocked: pendingCount > 0,
    pendingCount,
    latestDueDate: latest?.dueDate ?? null,
  });
}
