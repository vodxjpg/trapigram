// src/app/api/organizations/[identifier]/billing/route.ts
export const runtime = "nodejs";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sql } from "kysely";
import { getContext } from "@/lib/context";

// GET /api/organizations/[identifier]/billing
// Auth & org resolution exactly like platform-keys (via getContext)
export async function GET(req: NextRequest, { params }: { params: { identifier: string } }) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx; // unauthorized, forbidden, etc.
  const { organizationId } = ctx;

  // Resolve the owner of this organization (mirror platform-keys' "member" table)
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
    // Kysely: cast tuple → string[] for "in"
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
