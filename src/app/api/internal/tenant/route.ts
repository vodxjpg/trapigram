// src/app/api/internal/tenant/route.ts
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireInternalAuth } from "@/lib/internalAuth";
import crypto from "crypto";

export async function POST(req: NextRequest) {
  // 1) only your internal clients
  const authErr = requireInternalAuth(req);
  if (authErr) return authErr;

  // 2) parse payload
  let body: { plan?: string; userId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const { plan, userId } = body;
  if (!plan || !userId) {
    return NextResponse.json(
      { error: "plan and userId are required" },
      { status: 400 }
    );
  }

  // 3) pick default percent by plan
  let percent: string;
  switch (plan) {
    case "enterprise":
      percent = "0.05"; // 0.5%
      break;
    case "pro":
      percent = "0.05";  // 1%
      break;
    default:
      percent = "0.05";  // 2%
  }

  const tenantId = crypto.randomUUID();
  const rateId   = crypto.randomUUID();
  const now      = new Date();

  // 4) do both inserts in a single transaction
  try {
    await db.transaction().execute(async (trx) => {
      // a) create tenant
      await trx
        .insertInto("tenant")
        .values({
          id: tenantId,
          ownerUserId: userId,
          ownerName: null,
          ownerEmail: null,
          plan,
          createdAt: now,
          updatedAt: now,
        })
        .execute();

      // b) insert initial fee rate
      await trx
        .insertInto("userFeeRates")
        .values({
          id: rateId,
          userId,
          percent,
          startsAt: now,
          endsAt: null,
          createdAt: now,
        })
        .execute();
    });
  } catch (err) {
    console.error("tenant/fee transaction failed:", err);
    return NextResponse.json(
      { error: "Failed to create tenant & fee rate" },
      { status: 500 }
    );
  }

  return NextResponse.json({ tenantId, plan, defaultPercent: percent });
}
