// src/hooks/use-permission.ts
"use client";

import { useCallback, useEffect, useState } from "react";
import { authClient }   from "@/lib/auth-client";
import { getMember }    from "@/lib/auth-client/get-member";

export function usePermission(organizationId?: string) {
  /* ───────────────────────── State ───────────────────────── */
  const [role,    setRole] = useState<string | null>(null);     // null === loading
  const [cache]            = useState(() => new Map<string, boolean>());
  const [version, bump]    = useState(0);                       // bumps force re-render

  /* ───────────────── 1) Resolve active role ───────────────── */
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const res = organizationId
          ? await getMember({ organizationId })
          : await authClient.organization.getActiveMember();

        const resolvedRole = (res?.data?.role ?? "").toLowerCase();
        console.debug("[usePermission] active role =", resolvedRole);   // 🐞

        if (!cancelled) setRole(resolvedRole);
      } catch (err) {
        if (!cancelled) {
          console.warn("[usePermission] failed to resolve role:", err);
          setRole("");   // treat as guest
        }
      }
    })();

    return () => { cancelled = true; };
  }, [organizationId]);

  const loading = role === null;

  /* ───────────────── 2) Permission checker ───────────────── */
  const can = useCallback(
    (perm: Record<string, string[]>) => {
      const key = JSON.stringify(perm);

      /* cache hit? */
      if (cache.has(key)) {
        const hit = cache.get(key)!;
        console.debug("[usePermission] cache hit", key, "→", hit);      // 🐞
        return hit;
      }

      /* owner shortcut */
      if (role === "owner") {
        console.debug("[usePermission] owner shortcut → true", key);    // 🐞
        cache.set(key, true);
        return true;
      }

      /* Ask the server */
      console.debug("[usePermission] request >", perm);                 // 🐞
      authClient.organization
        .hasPermission({ permissions: perm, ...(organizationId && { organizationId }) })
        .then(({ data }) => {
          console.debug("[usePermission] reply  <", perm, "→", !!data); // 🐞
          cache.set(key, !!data);
          bump(v => v + 1);                                             // trigger re-render
        })
        .catch(err => {
          console.error("[usePermission] error:", err);
          cache.set(key, false);
          bump(v => v + 1);
        });

      cache.set(key, false);    // pessimistic until server replies
      return false;
    },
    [role, organizationId, cache, version]
  );

  /* ───── expose extras on the function object (legacy) ───── */
  (can as any).loading = loading;
  (can as any).role    = role;
  (can as any).version = version;

  return can as typeof can & { loading: boolean; role: string | null };
}
