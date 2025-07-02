// src/hooks/use-permission.ts
"use client";

import { useCallback, useMemo, useEffect, useState } from "react";
import { authClient } from "@/lib/auth-client";

/**
 * Checks whether the current user has a set of permissions inside
 * a specific organisation.  
 *
 * @param organizationId – optional; if omitted we fall back to the
 * “active” organisation (previous behaviour).
 *
 * Usage:
 *   const can = usePermission(organizationId);
 *   if (can({ invitation: ["create"] })) …
 */
export function usePermission(organizationId?: string) {
  const [role, setRole] = useState<string | null>(null); // null = loading

  // ---------------------------------------------------------------------------
  // Load the role that the **current user** has in the *requested* organisation
  // ---------------------------------------------------------------------------
  useEffect(() => {
    let cancelled = false;

    async function fetchRole() {
      try {
        const res = organizationId
          ? await authClient.organization.getMember({ organizationId })
          : await authClient.organization.getActiveMember();

        if (!cancelled) {
          // normalise to lower-case so `"Owner"` / `"OWNER"` work too
          setRole((res?.data?.role || "").toLowerCase());
        }
      } catch {
        if (!cancelled) setRole(""); // treat as “no role”
      }
    }

    fetchRole();
    return () => {
      cancelled = true;
    };
  }, [organizationId]);

  const loading = role === null;

  // simple cache to avoid recomputing the same permission check
  const cache = useMemo(() => new Map<string, boolean>(), [role]);

  // ---------------------------------------------------------------------------
  // Permission checker
  // ---------------------------------------------------------------------------
  return useCallback(
    (perm: Record<string, string[]>) => {
      // 1. Owner can do anything
      if (role === "owner") return true;

      // 2. While the hook is still loading, allow the UI to render optimistically
      if (loading) return true;

      // 3. Check + memoise
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
}
