// src/app/api/organizations/[identifier]/billing/route.ts
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sql } from "kysely";
import { getContext } from "@/lib/context";

// GET /api/organizations/[identifier]/billing
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ identifier: string }> }
) {
  const { identifier } = await params;

  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { organizationId } = ctx;

  if (identifier !== organizationId) {
    return NextResponse.json({ blocked: false, reason: "org_mismatch" }, { status: 403 });
  }

  const owner = await db
    .selectFrom("member")
    .select(["userId"])
    .where("organizationId", "=", organizationId)
    .where("role", "=", "owner")
    .executeTakeFirst();

  if (!owner?.userId) {
    return NextResponse.json({ blocked: false, reason: "org_or_owner_not_found" });
  }

  const PENDING_STATES = ["pending", "underpaid", "overdue", "unpaid"] as const;

  const cntRow = await db
    .selectFrom("userInvoices")
    .select(sql<number>`count(*)`.as("count"))
    .where("userId", "=", owner.userId)
    .where("status", "in", PENDING_STATES as unknown as string[])
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
