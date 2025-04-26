// /home/zodx/Desktop/trapigram/src/app/api/organizations/get-invitation/route.ts
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");

  if (!id) {
    return NextResponse.json({ error: "Invitation ID is required" }, { status: 400 });
  }

  try {
    const invitation = await db
      .selectFrom("invitation")
      .select(["email", "status"])
      .where("id", "=", id)
      .executeTakeFirst();

    if (!invitation) {
      return NextResponse.json({ error: "Invitation not found" }, { status: 404 });
    }

    if (invitation.status !== "pending") {
      return NextResponse.json({ error: `Invitation status is ${invitation.status}` }, { status: 400 });
    }

    return NextResponse.json({ email: invitation.email });
  } catch (error) {
    console.error("Error fetching invitation:", error);
    return NextResponse.json({ error: "Failed to fetch invitation" }, { status: 500 });
  }
}