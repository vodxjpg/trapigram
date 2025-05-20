// src/app/api/organizations/platform-key/route.ts
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getContext } from "@/lib/context";

const SERVICE_API_KEY = process.env.SERVICE_API_KEY ?? "";

export async function GET(req: NextRequest) {
  const isService = req.headers.get("x-api-key") === SERVICE_API_KEY;
  let organizationId: string | null = null;

  /* 1 — service account: organisationId **must** come from the query */
  if (isService) {
    organizationId = new URL(req.url).searchParams.get("organizationId");
    if (!organizationId) {
      return NextResponse.json(
        { error: "organizationId query parameter is required" },
        { status: 400 },
      );
    }
  } else {
    /* 2 — normal user flow uses getContext */
    const ctx = await getContext(req);
    if (ctx instanceof NextResponse) return ctx;
    organizationId = ctx.organizationId;
  }

  try {
    const platformKeys = await db
      .selectFrom("organizationPlatformKey")
      .select(["id", "platform", "apiKey", "createdAt", "updatedAt"])
      .where("organizationId", "=", organizationId)
      .execute();

    return NextResponse.json({ platformKeys }, { status: 200 });
  } catch (error) {
    console.error("[GET /api/organizations/platform-key] error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
