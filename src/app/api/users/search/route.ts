import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getContext } from "@/lib/context";

export async function GET(req: NextRequest) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;

  try {
    const { searchParams } = new URL(req.url);
    const email = searchParams.get("email");

    if (!email) {
      return NextResponse.json({ error: "Email query parameter is required" }, { status: 400 });
    }

    const users = await db
      .selectFrom("user")
      .select(["id", "email", "name"])
      .where("email", "ilike", `%${email}%`)
      .execute();

    return NextResponse.json({ users }, { status: 200 });
  } catch (error) {
    console.error("[GET /api/users/search] error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}