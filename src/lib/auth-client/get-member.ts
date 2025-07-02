// src/lib/auth-client/get-member.ts
import { authFetch } from "@/lib/auth-client/utils";

/** 
 * If you already have the org-ID, pass it so the server skips a DB round-trip.
 * Otherwise omit it and let the server fall back to the “active” organization 
 * from the session the user is sending.
 */
export async function getMember(
  opts: { organizationId?: string } = {},
) {
  const url = new URL("/api/auth/organization/get-member", window.location.origin);
  if (opts.organizationId) url.searchParams.set("organizationId", opts.organizationId);

  const res = await authFetch(url.toString(), { method: "GET" });
  if (!res.ok) throw new Error(res.statusText);

  return (await res.json()) as {
    data: { id: string; role: string; organizationId: string } | null;
  };
}
