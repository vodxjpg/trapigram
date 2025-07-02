/* src/hooks/use-permission.ts */
"use client";

import { useCallback, useMemo, useEffect, useState } from "react";
import { authClient } from "@/lib/auth-client";
import { getMember } from "@/lib/auth-client/get-member";
import { Permission } from "@/lib/permissions";

export function usePermission(organizationId?: string) {
  const [role, setRole] = useState<string | null>(null); // null = loading
  const [permissions, setPermissions] = useState<Record<string, boolean>>({});
  const cache = useMemo(() => new Map<string, boolean>(), [role]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
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

        // Define permissions to check with strict typing
        const permsToCheck: Permission[] = [
          { order: ["view"] },
          { order: ["view_pricing"] },
          { order: ["update_status"] },
          { order: ["update_tracking"] },
          { order: ["update"] },
          { ticket: ["view"] },
          { ticket: ["update"] },
        ];

        // Fetch permissions from the server
        const results = await Promise.all(
          permsToCheck.map(async (perm) => {
            const result = await authClient.organization.hasPermission({ permissions: perm });
            console.log("[usePermission] Raw hasPermission response for", perm, ":", result);
            return result;
          })
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

  const checker = useCallback(
    async (perm: Permission) => {
      if (role === "owner") return true;
      if (role === null) return true; // Optimistic during loading
      const key = JSON.stringify(perm);
      if (cache.has(key)) {
        const cached = cache.get(key)!;
        console.log("[usePermission] Cached result for", perm, ":", cached);
        return cached;
      }
      console.log("[usePermission] Fetching uncached permission:", perm);
      const { data } = await authClient.organization.hasPermission({ permissions: perm });
      const hasPermission = data?.hasPermission || false;
      cache.set(key, hasPermission);
      setPermissions((prev) => ({ ...prev, [key]: hasPermission }));
      return hasPermission;
    },
    [cache, role]
  );

  return Object.assign(checker, { loading: role === null, role }) as typeof checker & {
    loading: boolean;
    role: string | null;
  };
}