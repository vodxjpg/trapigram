// src/hooks/use-permission.ts    〈only this file changes〉
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { authClient } from "@/lib/auth-client";
import { getMember } from "@/lib/auth-client/get-member";

export function usePermission(organizationId?: string) {
  const [role, setRole] = useState<string | null>(null);              // null = loading
  const [cache] = useState(() => new Map<string, boolean>());         // stable ref
  const [tick, setTick] = useState(0);                                // ← NEW

  /* ── 1. Resolve active role ───────────────────────────────────── */
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
          console.warn("[usePermission] failed to load role:", err);
          setRole(""); // treat as guest
        }
      }
    })();
    return () => { cancelled = true; };
  }, [organizationId]);

  const loading = role === null;

  /* ── 2. Permission checker (sync) ─────────────────────────────── */
  const can = useCallback(
    (perm: Record<string, string[]>) => {
      const key = JSON.stringify(perm);
      if (cache.has(key)) return cache.get(key)!;

      /* owner is always allowed */
      if (role === "owner") {
        cache.set(key, true);
        return true;
      }

      /* Ask the server */
      authClient.organization
        .hasPermission({ permissions: perm, ...(organizationId && { organizationId }) })
        .then(({ data }) => {
          cache.set(key, !!data);
          setTick((t) => t + 1);            // ← force a re-render
        })
        .catch((err) => {
          console.error("[usePermission] hasPermission failed:", err);
          cache.set(key, false);
          setTick((t) => t + 1);            // ← re-render even on error
        });

      /* pessimistic until we know */
      cache.set(key, false);
      return false;
    },
    [role, organizationId, cache]
  );

  /* expose metadata */
  (can as any).loading = loading;
  (can as any).role    = role;

  /* `tick` is only used to trigger React updates */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _unused = tick;

  return can as typeof can & { loading: boolean; role: string | null };
}
