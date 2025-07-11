// src/app/api/in-app-notifications/route.ts
export const runtime = "nodejs";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getContext } from "@/lib/context";

const querySchema = z.object({
  limit: z.coerce.number().int().positive().max(50).default(10),
});

export async function GET(req: NextRequest) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;

  /* Validate search params */
  const parsed = querySchema.safeParse(
    Object.fromEntries(new URL(req.url).searchParams.entries()),
  );
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid query" }, { status: 400 });
  }
  const { limit } = parsed.data;

  /* Rows for dropdown */
  const rows = await db
    .selectFrom("inAppNotifications")
    .select(["id", "title", "read", "createdAt", "url"]) 
    .where("organizationId", "=", ctx.organizationId)
    .where("userId", "=", ctx.userId)
    .orderBy("createdAt desc")
    .limit(limit)
    .execute();

  /* Unread count (full, not limited) */
  const [{ cnt }] = await db
    .selectFrom("inAppNotifications")
    .select(db.fn.count<string>("id").as("cnt"))
    .where("organizationId", "=", ctx.organizationId)
    .where("userId", "=", ctx.userId)
    .where("read", "=", false)
    .execute();

  return NextResponse.json(
    { notifications: rows, unreadCount: Number(cnt) },
    { status: 200 },
  );
}
