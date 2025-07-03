"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { authClient } from "@/lib/auth-client";
import { getMember } from "@/lib/auth-client/get-member";

/**
 * usePermission
 * -------------
 * If you pass `organizationId`, permissions are checked for that org.
 * Otherwise we fall back to the active org in the session.
 *
 * `can(perm)` → boolean (synchronous, cached after first call)
 * `can.loading` → true while the first check is pending
 * `can.role`    → the member’s role string or null
 */
export function usePermission(organizationId?: string) {
  const [role, setRole] = useState<string | null>(null);   // null = loading
  const [cache] = useState(() => new Map<string, boolean>()); // stable ref

  /* ── 1. Resolve active role ─────────────────────────────────────────── */
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const res = organizationId
          ? await getMember({ organizationId })
          : await authClient.organization.getActiveMember();

        if (cancelled) return;
        setRole((res?.data?.role ?? "").toLowerCase());
      } catch (err) {
        if (!cancelled) {
          console.warn("[usePermission] failed to load role:", err);
          setRole("");                // treat as guest / no role
        }
      }
    })();

    return () => { cancelled = true; };
  }, [organizationId]);

  const loading = role === null;

  /* ── 2. Permission checker ──────────────────────────────────────────── */
  const can = useCallback(
    (perm: Record<string, string[]>) => {
      const key = JSON.stringify(perm);
      if (cache.has(key)) return cache.get(key)!;

      // ► OWNER is still handled client-side for zero latency
      if (role === "owner") {
        cache.set(key, true);
        return true;
      }

      // ► Ask the server. The answer always reflects the DB.
      //    (`organizationId` is optional; Better-Auth will use the active org)
      authClient.organization
        .hasPermission({ permissions: perm, ...(organizationId && { organizationId }) })
        .then(({ data }) => {
          cache.set(key, !!data);
        })
        .catch((err) => {
          console.error("[usePermission] hasPermission failed:", err);
          cache.set(key, false);
        });

      // optimistic *false* until the Promise resolves
      return false;
    },
    [role, organizationId, cache],
  );

  (can as any).loading = loading;
  (can as any).role    = role;
  return can as typeof can & { loading: boolean; role: string | null };
}
