// src/hooks/use-permission.ts
"use client";

import { useCallback, useMemo, useEffect, useState } from "react";
import { authClient } from "@/lib/auth-client";
import { getMember } from "@/lib/auth-client/get-member";

/**
 * usePermission
 * -------------
 * • If you pass `organizationId`, permissions are checked for that org.
 * • Otherwise the hook falls back to the active org in the session.
 *
 * `can(perm)` returns a boolean and also carries:
 *   – can.loading  • true while the role is still loading
 *   – can.role     • the resolved role string or null
 */
export function usePermission(organizationId?: string) {
  const [role, setRole] = useState<string | null>(null); // null = loading

  /* ── 1. Resolve role ─────────────────────────────────────────── */
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const res = organizationId
          ? await getMember({ organizationId })
          : await authClient.organization.getActiveMember();

        if (cancelled) return;

        const resolved = res?.data?.role || "";
        console.log(
          "[usePermission] org =", organizationId ?? "<active>",
          "→ role =", resolved || "<none>"
        );
        setRole(resolved);
      } catch (err) {
        if (!cancelled) {
          console.warn("[usePermission] failed to load role:", err);
          setRole(""); // treat as guest / no role
        }
      }
    })();

    return () => { cancelled = true; };
  }, [organizationId]);

  const loading = role === null;
  const cache = useMemo(() => new Map<string, boolean>(), [role]);

  /* ── 2. Permission checker ───────────────────────────────────── */
  const checker = useCallback(
    (perm: Record<string, string[]>) => {
      if (role === "owner") return true;
      if (loading) return true;
  
      const key = JSON.stringify(perm);
      if (cache.has(key)) return cache.get(key)!;
  
      const userRoles = role ? role.split(",") : [];
      console.log("[usePermission] Checking permission:", perm, "for roles:", userRoles);
  
      const ok = userRoles.some((r) => {
        const result = (authClient.organization as any).checkRolePermission({
          permissions: perm,
          role: r,
        });
        console.log(`[usePermission] Role ${r} check result:`, result);
        return result;
      });
  
      console.log("[usePermission] Final result:", ok);
      cache.set(key, ok);
      return ok;
    },
    [cache, role, loading]
  );

  /* Attach metadata */
  (checker as any).loading = loading;
  (checker as any).role = role;

  return checker as typeof checker & { loading: boolean; role: string | null };
}