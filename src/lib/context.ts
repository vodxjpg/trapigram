import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

export type RequestContext = {
  organizationId: string;
  userId: string;
  tenantId: string;
};

/**
 * Validate x-api-key or x-internal-secret + optional ?organizationId,
 * or fall back to session. Then fetch tenant by user.
 * Returns NextResponse on error, or RequestContext on success.
 */
export async function getContext(
  req: NextRequest,
): Promise<RequestContext | NextResponse> {
  const apiKey = req.headers.get("x-api-key");
  const internalSecret = req.headers.get("x-internal-secret");
  const explicitOrg = new URL(req.url).searchParams.get("organizationId");

  // API key branch
  if (apiKey) {
    const { valid, error } = await auth.api.verifyApiKey({ body: { key: apiKey } });
    if (!valid) {
      return NextResponse.json({ error: error?.message || "Invalid API key" }, { status: 401 });
    }
    if (!explicitOrg) {
      return NextResponse.json(
        { error: "organizationId query parameter is required" },
        { status: 400 },
      );
    }
  }

  // session for internal-secret and fallback
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Determine organizationId
  let organizationId = explicitOrg;
  if (!organizationId) {
    if (internalSecret === process.env.INTERNAL_API_SECRET) {
      organizationId = session.session.activeOrganizationId;
    } else if (!apiKey) {
      organizationId = session.session.activeOrganizationId;
    }
  }
  if (!organizationId) {
    return NextResponse.json({ error: "No active organization" }, { status: 400 });
  }

  // Get the user and tenant
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
