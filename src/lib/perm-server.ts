/* src/lib/perm-server.ts */
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";

type AuthApiWithPerm = typeof auth.api & {
  hasPermission(args: {
    headers: Headers;
    body: { permissions: Record<string, string[]> };
  }): Promise<{ data?: { allowed: boolean }; error?: any }>;
};

export async function requirePermission(
  req: NextRequest,
  permissions: Record<string, string[]>,
) {
  const api = auth.api as AuthApiWithPerm;

  const res = await api.hasPermission({
    headers: req.headers,
    body: { permissions },
  });

  if (res.error || !res.data?.allowed) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return null;                 // ✅ caller may proceed
}
