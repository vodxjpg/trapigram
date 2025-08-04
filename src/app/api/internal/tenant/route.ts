// src/app/api/internal/tenant/route.ts
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import crypto from "crypto";

export async function POST(req: NextRequest) {
  // 1) Ensure we have a valid user session
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401 }
    );
  }
  const userId = session.user.id;

  // 2) Parse & validate body
  let body: { plan?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON" },
      { status: 400 }
    );
  }
  const { plan } = body;
  if (!plan) {
    return NextResponse.json(
      { error: "plan is required" },
      { status: 400 }
    );
  }

  // 3) Pick default fee % by plan
  let percent: string;
  switch (plan) {
    case "enterprise":
      percent = "5"; // 0.5%
      break;
    case "pro":
      percent = "5";  // 1%
      break;
    default:
      percent = "5";  // 2%
  }

  const tenantId = crypto.randomUUID();
  const rateId   = crypto.randomUUID();
  const now      = new Date();

  // 4) Create tenant + initial fee rate in one transaction
  try {
    await db.transaction().execute(async (trx) => {
      // a) create the tenant
      await trx
        .insertInto("tenant")
        .values({
          id:                   tenantId,
          ownerUserId:          userId,
          ownerName:            session.user.name ?? null,
          ownerEmail:           session.user.email ?? null,
          plan,
          createdAt:            now,
          updatedAt:            now,
          onboardingCompleted:  0,
        })
        .execute();

      // b) insert the user's first fee rate
      await trx
        .insertInto("userFeeRates")
        .values({
          id:        rateId,
          userId,
          percent,
          startsAt:  now,
          endsAt:    null,
          createdAt: now,
        })
        .execute();
    });
  } catch (err) {
    console.error("[tenant/fee] transaction failed:", err);
    return NextResponse.json(
      { error: "Failed to create tenant & fee rate" },
      { status: 500 }
    );
  }

  // 5) Redirect to onboarding
  const url = new URL("/onboarding", req.url);
  return NextResponse.redirect(url, { status: 302 });
}
