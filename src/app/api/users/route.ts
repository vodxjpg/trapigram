export const runtime = "nodejs";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getContext } from "@/lib/context";

export async function GET(req: NextRequest) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;

  try {
    const users = await db
      .selectFrom("user")
      .select(["id", "email", "name"])
      .execute();

    return NextResponse.json({ users }, { status: 200 });
  } catch (error) {
    console.error("[GET /api/users] error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}