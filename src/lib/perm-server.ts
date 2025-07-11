/* src/lib/perm-server.ts */
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getContext } from "@/lib/context";
import { db } from "@/lib/db";
type AuthApiWithPerm = typeof auth.api & {
  hasPermission(args: {
    headers: Headers;
    body: { permissions: Record<string, string[]> };
  }): Promise<{ data?: { allowed: boolean }; error?: any }>;
};

/**
* Enforce a permission, but first bypass for:
*  • service‐account (x-api-key)
*  • org owner
*/
export async function requireOrgPermission(
  req: NextRequest,
  permissions: Record<string, string[]>
) {
  // 1) Resolve context (session, API key, service)
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { organizationId, userId } = ctx;

  // 1a) If the caller supplied *any* API key, skip all permission checks
  if (req.headers.get("x-api-key")) {
    return null;
  }

  // 2) Service-account (explicitly recognized in getContext) bypass
  //    (this is now redundant, but safe to keep)
  if (userId === "service-account") return null;

  // 3) Owner‐role bypass
  const ownerRow = await db
    .selectFrom("member")
    .select("id")
    .where("organizationId", "=", organizationId)
    .where("userId", "=", userId)
    .where("role", "=", "owner")
    .executeTakeFirst();
  if (ownerRow) return null;

  // 4) Otherwise fall through to Supabase’s ACL check
  const api = auth.api as AuthApiWithPerm;
  const res = await api.hasPermission({
    headers: req.headers,
    body: { permissions },
  });

  if (res.error || !res.data?.allowed) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return null;
}
