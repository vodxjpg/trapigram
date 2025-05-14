import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { verifyInternalPost, verifyAllowedOrigin } from "@/lib/verifyOrigin"; // ensure this export exists

/* verifyAllowedOrigin is used to protect GET from third-party requests*/
/* verifyInternalPost is used to protect POST modifications from third-party requests*/

export async function GET(req: NextRequest) {
  // 0) Block calls from unknown origins
  if (!verifyAllowedOrigin(req)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // 1) Validate query
  const email = req.nextUrl.searchParams.get("email");
  if (!email) {
    return NextResponse.json({ error: "Email is required" }, { status: 400 });
  }

  try {
    // 2) Safe lookup
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
