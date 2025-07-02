/* src/hooks/use-permission.ts */
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
  const [permissions, setPermissions] = useState<Record<string, boolean>>({});
  const cache = useMemo(() => new Map<string, boolean>(), [role]);

  /* ── 1. Resolve role and fetch permissions ───────────────────────── */
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        // Fetch the active role
        const res = organizationId
          ? await getMember({ organizationId })
          : await authClient.organization.getActiveMember();

        if (cancelled) return;

        const resolvedRole = res?.data?.role || "";
        console.log(
          "[usePermission] org =",
          organizationId ?? "<active>",
          "→ role =",
          resolvedRole || "<none>"
        );
        setRole(resolvedRole);

        if (resolvedRole === "owner") {
          setPermissions({}); // Owners have all permissions
          return;
        }

        // Define permissions to check
        const permsToCheck = [
          { order: ["view"] },
          { order: ["view_pricing"] },
          { order: ["update_status"] },
          { order: ["update_tracking"] },
          { order: ["update"] },
          { ticket: ["view"] },
          { ticket: ["update"] },
          // Add more as needed
        ];

        // Fetch permissions from the server
        const results = await Promise.all(
          permsToCheck.map((perm) =>
            authClient.organization.hasPermission({ permissions: perm })
          )
        );

        if (cancelled) return;

        const permissionMap = permsToCheck.reduce((acc, perm, index) => {
          const key = JSON.stringify(perm);
          const hasPermission = results[index].data?.hasPermission || false;
          acc[key] = hasPermission;
          console.log(
            "[usePermission] Checking permission:",
            perm,
            "for role:",
            resolvedRole,
            "→ Result:",
            hasPermission
          );
          cache.set(key, hasPermission);
          return acc;
        }, {} as Record<string, boolean>);

        setPermissions(permissionMap);
      } catch (err) {
        if (!cancelled) {
          console.warn("[usePermission] failed to load role or permissions:", err);
          setRole(""); // Treat as guest/no role
          setPermissions({});
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [organizationId, cache]);

  /* ── 2. Permission checker ───────────────────────────────────── */
  const checker = useCallback(
    (perm: Record<string, string[]>) => {
      if (role === "owner") return true;
      if (role === null) return true; // Optimistic during loading
      const key = JSON.stringify(perm);
      if (cache.has(key)) {
        const cached = cache.get(key)!;
        console.log("[usePermission] Cached result for", perm, ":", cached);
        return cached;
      }
      // Fallback to server check if not cached
      console.warn("[usePermission] Permission not cached:", perm);
      return false; // Avoid runtime API calls for uncached permissions
    },
    [cache, role]
  );

  /* Attach metadata */
  (checker as any).loading = role === null;
  (checker as any).role = role;

  return checker as typeof checker & { loading: boolean; role: string | null };
}