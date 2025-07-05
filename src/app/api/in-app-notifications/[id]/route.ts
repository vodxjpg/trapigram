// src/app/api/in-app-notifications/[id]/route.ts
export const runtime = "nodejs";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getContext } from "@/lib/context";

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;

  const id = z.string().uuid().parse(params.id);

  await db
    .updateTable("inAppNotifications")
    .set({ read: true, updatedAt: new Date() })
    .where("id", "=", id)
    .where("organizationId", "=", ctx.organizationId)
    .where("userId", "=", ctx.userId)
    .executeTakeFirst();

  return NextResponse.json({ id, read: true }, { status: 200 });
}
