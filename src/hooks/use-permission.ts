// ─── src/hooks/use-permission.ts (v3 – local check, no API call) ──────────
"use client";

import { useCallback, useEffect, useState } from "react";
import { authClient }   from "@/lib/auth-client";
import { getMember }    from "@/lib/auth-client/get-member";
import { resolveRole }  from "@/lib/auth/role-resolver";
import { ac }           from "@/lib/permissions";          // same AC instance

type Perm = Record<string, string[]>;                      // { resource: [actions] }

export function usePermission(organizationId?: string) {
  /* ──────────────── 1. Who am I? (role) ──────────────── */
  const [role, setRole] = useState<string | null>(null);   // null = loading

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = organizationId
          ? await getMember({ organizationId })
          : await authClient.organization.getActiveMember();

        const r = (res?.data?.role ?? "").toLowerCase();
        !cancelled && setRole(r);
      } catch (err) {
        console.warn("[usePermission] could not resolve role:", err);
        !cancelled && setRole("");                         // guest
      }
    })();
    return () => { cancelled = true; };
  }, [organizationId]);

  const loading = role === null;

  /* ──────────────── 2. Local permission checker ──────────────── */
  const can = useCallback((perm: Perm) => {
    if (loading) return false;                             // still resolving

    // owners shortcut
    if (role === "owner") return true;

    // find the static GrantsRole for this user
    const grantsRole = resolveRole({
      organizationId: organizationId ?? "global",
      role: role ?? "",
    });

    if (!grantsRole) return false;                         // no such role

    // perm is e.g. { order: ["update_status"] }
    const [resource, actions] = Object.entries(perm)[0];

    // every action in the array must be granted
    return actions.every((action) =>
      ac.can(grantsRole.role).execute(action).on(resource).granted
    );
  }, [loading, role, organizationId]);

  /* legacy flags */
  (can as any).loading = loading;
  (can as any).role    = role;

  return can as typeof can & { loading: boolean; role: string | null };
}
