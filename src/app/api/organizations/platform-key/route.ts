// src/app/api/organizations/platform-key/route.ts
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getContext } from "@/lib/context";
import { createHash } from "crypto";

const SERVICE_API_KEY = process.env.SERVICE_API_KEY ?? "";

/** Signature changes when rows are added/removed/updated (no secrets hashed). */
function computeSignature(rows: Array<{
  id: string;
  platform: string;
  updatedAt: string | Date;
}>): string {
  const basis = rows
    .map((r) => `${r.id}:${r.platform}:${new Date(r.updatedAt).getTime()}`)
    .sort()
    .join("|");
  return createHash("sha256").update(basis).digest("hex");
}

export async function GET(req: NextRequest) {
  const isService = req.headers.get("x-api-key") === SERVICE_API_KEY;
  let organizationId: string | null = null;

  if (isService) {
    organizationId = new URL(req.url).searchParams.get("organizationId");
    if (!organizationId) {
      return NextResponse.json(
        { error: "organizationId query parameter is required" },
        { status: 400 },
      );
    }
  } else {
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

    const lastUpdated =
      platformKeys.length > 0
        ? new Date(
            Math.max(
              ...platformKeys.map((k) => new Date(k.updatedAt as any).getTime()),
            ),
          ).toISOString()
        : null;

    const signature = computeSignature(
      platformKeys.map((k) => ({
        id: k.id,
        platform: k.platform,
        updatedAt: k.updatedAt,
      })),
    );

    // Conditional 304 path
    const inm = req.headers.get("if-none-match");
    if (inm && inm.replace(/^W\//, "").replace(/"/g, "") === signature) {
      const res304 = new NextResponse(null, { status: 304 });
      res304.headers.set('ETag', `W/"${signature}"`);
      res304.headers.set("Cache-Control", "private, max-age=0, must-revalidate");
      res304.headers.set("X-Keys-Count", String(platformKeys.length));
      if (lastUpdated) res304.headers.set("X-Last-Updated", lastUpdated);
      return res304;
    }

    const res = NextResponse.json(
      { platformKeys, signature, count: platformKeys.length, lastUpdated },
      { status: 200 },
    );
    res.headers.set('ETag', `W/"${signature}"`);
    res.headers.set("Cache-Control", "private, max-age=0, must-revalidate");
    if (lastUpdated) res.headers.set("X-Last-Updated", lastUpdated);
    res.headers.set("X-Keys-Count", String(platformKeys.length));
    return res;
  } catch (error) {
    console.error("[GET /api/organizations/platform-key] error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
