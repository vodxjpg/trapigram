import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";            // TLS-secured pool
import { getContext } from "@/lib/context"; // ⬅️ your secure context helper

// This endpoint queries Postgres → must stay on Node.js, not the Edge runtime
export const runtime = "nodejs";

/**
 * GET /api/auth/organization/get-member?organizationId=abc123
 *
 * Response: { data: { id, role, userId, organizationId } | null }
 *
 * Notes:
 *   – organizationId may come from the query param **or** the active session
 *     that getContext resolves for the caller; we trust whichever is present.
 *   – Any auth failure or bad input is already handled inside getContext.
 */
export async function GET(req: NextRequest) {
  // ────────────────────────────────────────────────────────────────
  // 1. Authenticate + enrich request (JWT / HMAC / API-Key / Session)
  // ────────────────────────────────────────────────────────────────
  const ctxOrRes = await getContext(req);
  if (ctxOrRes instanceof NextResponse) return ctxOrRes; // → 4xx/5xx

  const { userId, organizationId: ctxOrgId } = ctxOrRes;
  const urlOrgId = new URL(req.url).searchParams.get("organizationId") ?? undefined;
  const organizationId = urlOrgId ?? ctxOrgId;

  if (!organizationId) {
    return NextResponse.json(
      { error: "organizationId is required (query param or active session)" },
      { status: 400 },
    );
  }

  // ────────────────────────────────────────────────────────────────
  // 2. Query the member row through the secure Kysely pool
  // ────────────────────────────────────────────────────────────────
  const member = await db
    .selectFrom("member")
    .select(["id", "role", "userId", "organizationId"])
    .where("organizationId", "=", organizationId)
    .where("userId", "=", userId)
    .executeTakeFirst();                 // → object | undefined

  return NextResponse.json({ data: member ?? null });
}
