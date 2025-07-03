// src/hooks/use-permission.ts
"use client";
import { useCallback, useEffect, useState } from "react";
import { authClient } from "@/lib/auth-client";
import { getMember }  from "@/lib/auth-client/get-member";

export function usePermission(organizationId?: string) {
  const [role, setRole]   = useState<string | null>(null);   // null = loading
  const [cache]           = useState(() => new Map<string, boolean>());
  const [version, bump]   = useState(0);                     // ← NEW

  /* 1. Resolve active role ------------------------------------------------ */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = organizationId
          ? await getMember({ organizationId })
          : await authClient.organization.getActiveMember();
        if (!cancelled) setRole((res?.data?.role ?? "").toLowerCase());
      } catch (err) {
        if (!cancelled) {
          console.warn("[usePermission] failed:", err);
          setRole("");          // treat as guest
        }
      }
    })();
    return () => { cancelled = true; };
  }, [organizationId]);

  const loading = role === null;

  /* 2. The checker – identity now depends on `version` -------------------- */
  const can = useCallback(
    (perm: Record<string, string[]>) => {
      const key = JSON.stringify(perm);
      if (cache.has(key)) return cache.get(key)!;

      if (role === "owner") {               // owner shortcut
        cache.set(key, true);
        return true;
      }

      // Ask the server
      authClient.organization
        .hasPermission({ permissions: perm, ...(organizationId && { organizationId }) })
        .then(({ data }) => { cache.set(key, !!data); bump(v => v + 1); })
        .catch(err => { console.error("[usePermission] error:", err); cache.set(key, false); bump(v => v + 1); });

      cache.set(key, false);                // pessimistic until reply
      return false;
    },
    [role, organizationId, cache, version]  // ← `version` included
  );

  (can as any).loading  = loading;
  (can as any).role     = role;
  (can as any).version  = version;           // expose if you need it
  return can as typeof can & { loading: boolean; role: string | null };
}
