// src/lib/context.ts
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

export type RequestContext = {
  organizationId: string;
  userId: string;
  tenantId: string;
};

const SERVICE_API_KEY = process.env.SERVICE_API_KEY ?? "";

/**
 * Resolve organisation / tenant context for:
 *   • Service account  (x-api-key === SERVICE_API_KEY) – global read-only
 *   • Personal API key (verified via Better Auth)
 *   • Session cookie   (normal browser flow)
 *
 * Always require ?organizationId= when an API key is used.
 */
export async function getContext(
  req: NextRequest,
): Promise<RequestContext | NextResponse> {
  const apiKey = req.headers.get("x-api-key");
  const explicitOrg = new URL(req.url).searchParams.get("organizationId");

  /* ────────────────────────────────────────────────────────────────
     1 — SERVICE ACCOUNT  (global robot key)
     ──────────────────────────────────────────────────────────────── */
  if (apiKey === SERVICE_API_KEY) {
    if (!explicitOrg) {
      return NextResponse.json(
        { error: "organizationId query parameter is required" },
        { status: 400 },
      );
    }

    /* 1a – try tenantId from organization.metadata */
    const orgRow = await db
      .selectFrom("organization")
      .select(["metadata"])
      .where("id", "=", explicitOrg)
      .executeTakeFirst();

    if (!orgRow) {
      return NextResponse.json({ error: "Organization not found" }, { status: 404 });
    }

    let tenantId: string | undefined;
    if (orgRow.metadata) {
      try {
        const meta = typeof orgRow.metadata === "string"
          ? JSON.parse(orgRow.metadata)
          : orgRow.metadata;
        tenantId = meta?.tenantId;
      } catch {
        /* ignore JSON parse error – fallback below */
      }
    }

    /* 1b – fallback: look for owner in member → tenant */
    if (!tenantId) {
      const ownerMember = await db
        .selectFrom("member")
        .select("userId")
        .where("organizationId", "=", explicitOrg)
        .where("role", "=", "owner")
        .executeTakeFirst();

      if (ownerMember) {
        const tenantRow = await db
          .selectFrom("tenant")
          .select("id")
          .where("ownerUserId", "=", ownerMember.userId)
          .executeTakeFirst();
        tenantId = tenantRow?.id;
      }
    }

    if (!tenantId) {
      return NextResponse.json(
        { error: "Unable to determine tenantId for organization" },
        { status: 500 },
      );
    }

    return {
      organizationId: explicitOrg,
      userId: "service-account",
      tenantId,
    };
  }

  /* ────────────────────────────────────────────────────────────────
     2 — PERSONAL API KEY  (verified via Better Auth)
     ──────────────────────────────────────────────────────────────── */
  if (apiKey) {
    const { valid, error } = await auth.api.verifyApiKey({ body: { key: apiKey } });
    if (!valid) {
      return NextResponse.json(
        { error: error?.message || "Invalid API key" },
        { status: 401 },
      );
    }
    if (!explicitOrg) {
      return NextResponse.json(
        { error: "organizationId query parameter is required" },
        { status: 400 },
      );
    }
  }

  /* ────────────────────────────────────────────────────────────────
     3 — SESSION COOKIE  (normal browser flow)
     ──────────────────────────────────────────────────────────────── */
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  /* determine organisation */
  let organizationId = explicitOrg;
  if (!organizationId && !apiKey) {
    organizationId = session.session.activeOrganizationId;
  }
  if (!organizationId) {
    return NextResponse.json({ error: "No active organization" }, { status: 400 });
  }

  /* derive tenant via ownerUserId → tenant */
  const userId = session.user.id;
  const tenantRow = await db
    .selectFrom("tenant")
    .select("id")
    .where("ownerUserId", "=", userId)
    .executeTakeFirst();
  if (!tenantRow) {
    return NextResponse.json({ error: "No tenant found for user" }, { status: 404 });
  }

  return {
    organizationId,
    userId,
    tenantId: tenantRow.id,
  };
}
