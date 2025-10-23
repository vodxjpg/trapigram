// src/app/api/in-app-notifications/[id]/route.ts
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getContext } from "@/lib/context";

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;                 // ← async params
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;

  const parsedId = z.string().uuid().parse(id);

  await db
    .updateTable("inAppNotifications")
    .set({ read: true, updatedAt: new Date() })
    .where("id", "=", parsedId)
    .where("organizationId", "=", ctx.organizationId)
    .where("userId", "=", ctx.userId)
    .executeTakeFirst();

  return NextResponse.json({ id: parsedId, read: true }, { status: 200 });
}
