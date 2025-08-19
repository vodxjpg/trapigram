export const runtime = "nodejs";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

export async function POST(req: NextRequest) {
  const { token } = await req.json();

  if (!token) {
    return NextResponse.json({ error: "Invitation code (token) is required." }, { status: 400 });
  }

  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const shareLink = await db
    .selectFrom("warehouseShareLink")
    .innerJoin("warehouse", "warehouse.id", "warehouseShareLink.warehouseId")
    .innerJoin("user", "user.id", "warehouseShareLink.creatorUserId")
    .select([
      "warehouseShareLink.id",
      "warehouseShareLink.token",
      "warehouse.name as warehouseName",
      "user.name as creatorName",
      "user.email as creatorEmail",
    ])
    .where("warehouseShareLink.token", "=", token)
    .where("warehouseShareLink.status", "=", "active")
    .executeTakeFirst();

  if (!shareLink) {
    return NextResponse.json({ error: "Invalid or expired invitation code." }, { status: 404 });
  }

  return NextResponse.json({ shareLink });
}
