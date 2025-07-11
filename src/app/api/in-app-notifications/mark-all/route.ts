// src/app/api/in-app-notifications/mark-all/route.ts
export const runtime = "nodejs";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getContext } from "@/lib/context";

/**
 * PATCH /api/in-app-notifications/mark-all
 * Marks every unread notification for the caller as read.
 */
export async function PATCH(req: NextRequest) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;

  const { organizationId, userId } = ctx;

  await db
    .updateTable("inAppNotifications")
    .set({ read: true, updatedAt: new Date() })
    .where("organizationId", "=", organizationId)
    .where("userId", "=", userId)
    .where("read", "=", false)
    .executeTakeFirst();

  return NextResponse.json({ ok: true, allRead: true }, { status: 200 });
}
