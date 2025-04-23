import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

const INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET as string;

export async function GET(req: NextRequest) {
  try {
    const internalSecret = req.headers.get("x-internal-secret");
    const session = await auth.api.getSession({ headers: req.headers });

    if (!session && internalSecret !== INTERNAL_API_SECRET) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

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