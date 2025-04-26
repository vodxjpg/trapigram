// /src/app/api/auth/check-email/route.ts
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db"; // <-- Import the Kysely instance

export async function GET(req: NextRequest) {
  const email = req.nextUrl.searchParams.get("email");
  if (!email) {
    return NextResponse.json({ error: "Email is required" }, { status: 400 });
  }

  try {
    // Use a Kysely query:
    const row = await db
      .selectFrom("user")
      .select(["id"])
      .where("email", "=", email)
      .executeTakeFirst();

    return NextResponse.json({ exists: !!row });
  } catch (error) {
    console.error("Error checking email:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
