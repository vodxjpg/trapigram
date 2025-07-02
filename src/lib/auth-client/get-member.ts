import { authFetch } from "@/lib/auth-client/utils";

/**
 * Fetch the caller’s own member record for the given organisation.
 * If you omit `organizationId` it falls back to the active org.
 *
 * Returns: { data: { id, role, organizationId } | null }
 */
export async function getMember(opts: { organizationId?: string } = {}) {
  const url = new URL(
    "/api/auth/organization/get-member",
    window.location.origin,
  );
  if (opts.organizationId) {
    url.searchParams.set("organizationId", opts.organizationId);
  }

  // authFetch → throws on non-2xx and already returns parsed JSON
  return authFetch(url.toString(), { method: "GET" }) as Promise<{
    data: { id: string; role: string; organizationId: string } | null;
  }>;
}
