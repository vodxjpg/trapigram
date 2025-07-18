import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

export async function POST(req: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: req.headers });
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { userId, name } = await req.json();

    if (userId !== session.user.id) {
      return NextResponse.json({ error: "Unauthorized user" }, { status: 403 });
    }

    // Update the name in the user table
    await db
      .updateTable("user")
      .set({ name })
      .where("id", "=", userId)
      .execute();

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Update name error:", err);
    return NextResponse.json({ error: "Failed to update name" }, { status: 500 });
  }
}