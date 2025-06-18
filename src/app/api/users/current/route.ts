// src/app/api/users/current/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getContext } from "@/lib/context";
import { db } from "@/lib/db";

export async function GET(req: NextRequest) {
  // 1) authorize & resolve userId
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) {
    // if getContext returned a Response (error), bail out
    return ctx;
  }
  const { userId } = ctx;

  // 2) load only the safe fields
  const userRow = await db
    .selectFrom("user")
    .select([
      "id",
      "email",
      "name",
      "phone",
      "country",
      "is_guest",
      "emailVerified",
      "image",
      "createdAt",
      "updatedAt",
    ])
    .where("id", "=", userId)
    .executeTakeFirst();

  // 3) if not found, return null
  if (!userRow) {
    return NextResponse.json({ user: null }, { status: 200 });
  }

  // 4) serialize dates as ISO strings
  const user = {
    id: userRow.id,
    email: userRow.email,
    name: userRow.name,
    phone: userRow.phoneNumber,
    country: userRow.country,
    is_guest: userRow.is_guest,
    emailVerified: userRow.emailVerified,
    image: userRow.image,
    createdAt: userRow.createdAt?.toISOString() ?? null,
    updatedAt: userRow.updatedAt?.toISOString() ?? null,
  };

  return NextResponse.json({ user }, { status: 200 });
}
