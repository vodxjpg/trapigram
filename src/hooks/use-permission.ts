// src/hooks/use-permission.ts
"use client";

import { useCallback, useMemo, useEffect, useState } from "react";
import { authClient } from "@/lib/auth-client";

/**
 * usePermission
 * -------------
 * `organizationId` → string | undefined
 *   – pass a specific org ID when you have one
 *   – omit/leave undefined to fall back to the “active” organisation
 *
 * Returns a function `can(perm)` that answers true/false **and** carries a
 * `.loading` Boolean so existing code like `can.loading` keeps working.
 */
export function usePermission(organizationId?: string) {
  const [role, setRole] = useState<string | null>(null); // null = still loading

  // ────────────────────────────────────────────────────────────────────────────
  // 1. Look up the role for THIS organisation (or the active one)
  // ────────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;

    async function loadRole() {
      try {
        const res = organizationId
          ? await authClient.organization.getMember({ organizationId })
          : await authClient.organization.getActiveMember();

        if (!cancelled) {
          setRole((res?.data?.role || "").toLowerCase()); // normalise case
        }
      } catch {
        if (!cancelled) setRole(""); // treat “couldn’t fetch” as “no role”
      }
    }

    loadRole();
    return () => {
      cancelled = true;
    };
  }, [organizationId]);

  const loading = role === null;
  const cache = useMemo(() => new Map<string, boolean>(), [role]);

  // ────────────────────────────────────────────────────────────────────────────
  // 2. Permission checker
  // ────────────────────────────────────────────────────────────────────────────
  const checker = useCallback(
    (perm: Record<string, string[]>) => {
      // Owner can do anything
      if (role === "owner") return true;

      // While loading ⇒ optimistic true (prevents UI flicker)
      if (loading) return true;

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

  // Attach metadata so callers can read can.loading etc.
  (checker as any).loading = loading;
  (checker as any).role = role;

  return checker as typeof checker & {
    loading: boolean;
    role: string | null;
  };
}
