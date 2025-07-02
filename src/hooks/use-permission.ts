"use client";

import { useCallback, useMemo, useEffect, useState } from "react";
import { authClient } from "@/lib/auth-client";          // ✅ still needed
import { getMember } from "@/lib/auth-client/get-member"; // ✅ custom fetcher

/**
 * usePermission
 * -------------
 * Pass an `organizationId` when you know it; otherwise the hook will fall
 * back to the active org stored in the user’s session.
 *
 * Returns a function `can(perm)` with these extras:
 *   • can.loading  – true while the role is being fetched
 *   • can.role     – the resolved role (or null while loading)
 */
export function usePermission(organizationId?: string) {
  const [role, setRole] = useState<string | null>(null); // null = loading

  // 1 ─ Fetch role for the requested (or active) organisation
  useEffect(() => {
    let cancelled = false;

    async function loadRole() {
      try {
        const res = organizationId
          ? await getMember({ organizationId })            // ← our endpoint
          : await authClient.organization.getActiveMember();

        if (!cancelled) {
          setRole((res?.data?.role || "").toLowerCase());  // normalise case
        }
      } catch {
        if (!cancelled) setRole("");                       // treat as “no role”
      }
    }

    loadRole();
    return () => { cancelled = true; };
  }, [organizationId]);

  const loading = role === null;
  const cache   = useMemo(() => new Map<string, boolean>(), [role]);

  // 2 ─ Permission checker
  const checker = useCallback(
    (perm: Record<string, string[]>) => {
      if (role === "owner") return true;   // owner bypass
      if (loading) return true;            // optimistic until role loads

      const key = JSON.stringify(perm);
      if (cache.has(key)) return cache.get(key)!;

      const ok = authClient.organization.checkRolePermission({
        permissions: perm,
        role,
      });
      cache.set(key, ok);
      return ok;
    },
    [cache, role, loading],
  );

  (checker as any).loading = loading;
  (checker as any).role    = role;

  return checker as typeof checker & { loading: boolean; role: string | null };
}
