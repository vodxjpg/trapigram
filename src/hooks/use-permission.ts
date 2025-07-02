// src/hooks/use-permission.ts
"use client";

import { useCallback, useMemo, useEffect, useState } from "react";
import { authClient } from "@/lib/auth-client";
import { getMember } from "@/lib/auth-client/get-member";

/**
 * usePermission
 * -------------
 * If you pass `organizationId`, permissions are checked for that org.
 * Otherwise the hook relies on the active organization stored in the
 * Better-Auth session.
 *
 * The returned function `can(perm)` also carries:
 *   • can.loading  – true while the role is still loading
 *   • can.role     – the resolved role (string or null)
 */
export function usePermission(organizationId?: string) {
  const [role, setRole] = useState<string | null>(null); // null = loading

  /* ──────────────────────────────────────────────────────────────
   * 1. Load role for the requested (or active) organization
   * ────────────────────────────────────────────────────────────── */
  useEffect(() => {
    let cancelled = false;

    async function loadRole() {
      try {
        const res = organizationId
          ? await getMember({ organizationId })            // custom endpoint
          : await authClient.organization.getActiveMember();

        if (!cancelled) {
          const resolved = (res?.data?.role || "").toLowerCase();
          /*  🔍  TEMPORARY DEBUG LOG — remove when satisfied  */
          console.log(
            "[usePermission] org =", organizationId ?? "<active>",
            "→ role =", resolved || "<none>",
          );
          setRole(resolved);
        }
      } catch (err) {
        if (!cancelled) {
          console.warn("[usePermission] failed to load role:", err);
          setRole("");                                     // treat as “no role”
        }
      }
    }

    loadRole();
    return () => { cancelled = true; };
  }, [organizationId]);

  const loading = role === null;
  const cache   = useMemo(() => new Map<string, boolean>(), [role]);

  /* ──────────────────────────────────────────────────────────────
   * 2. Permission checker (memoised)
   * ────────────────────────────────────────────────────────────── */
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

  /* Attach metadata */
  (checker as any).loading = loading;
  (checker as any).role    = role;

  return checker as typeof checker & { loading: boolean; role: string | null };
}
