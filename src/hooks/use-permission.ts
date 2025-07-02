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

        const resolved = (res?.data?.role || "").toLowerCase();
        setRole(resolved);
      } catch (err) {
        if (!cancelled) {
          console.warn("[usePermission] failed to load role:", err);
          setRole("");                       // treat as guest / no role
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
      if (role === "owner") return true;       // owner bypass
      if (loading) return true;                // optimistic while loading
      const key = JSON.stringify(perm);
      if (cache.has(key)) return cache.get(key)!;

      /* ── 1: try fast, purely-local AC check ─────────────────── */
      let allowed: boolean | null = null;
      try {
        allowed = authClient.organization.checkRolePermission({
          permissions: perm,
          role,
        });
      } catch {
        /* role not registered in the local AC → ignore */
      }

      /* ── 2: if local AC doesn’t know this role, ask the server ─ */
      const evaluate = async () => {
        if (allowed !== null) return allowed;  // local result was fine
        const { data, error } =
          await authClient.organization.hasPermission({ permissions: perm });
        return error ? false : !!data?.allowed;
      };

      /* We store the Promise to avoid duplicate calls while it resolves */
      const promise = evaluate().then((ok) => {
        cache.set(key, ok);       // memoise result (true/false)
        return ok;
      });

      cache.set(key, promise as unknown as boolean); // type trick
      return false;  // while awaiting we behave as “no”
    },
    [cache, role, loading],
  );

  /* Attach metadata */
  (checker as any).loading = loading;
  (checker as any).role = role;

  return checker as typeof checker & { loading: boolean; role: string | null };
}
