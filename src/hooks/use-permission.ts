// ─── src/hooks/use-permission.ts  (v4 – local check, auto-prime roles) ────
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { authClient }     from "@/lib/auth-client";
import { getMember }      from "@/lib/auth-client/get-member";
import { resolveRole }    from "@/lib/auth/role-resolver";
import { registerRole }   from "@/lib/auth/role-registry";
import { ac }             from "@/lib/permissions";

type Perm = Record<string, string[]>;            // { resource: ["action"] }

/** tiny helper so we don’t re-prime the same org twice */
const primed = new Set<string>();

async function primeRolesOnce(orgId: string) {
  if (primed.has(orgId)) return;
  console.debug("[usePermission] priming roles for", orgId);
  primed.add(orgId);

  const res  = await fetch(`/api/organizations/${orgId}/roles`, {
    credentials: "include",
  });
  if (!res.ok) {
    console.warn("[usePermission] could not fetch roles:", res.status);
    return;
  }

  const { roles } = await res.json();            // [{ name, permissions }]
  roles.forEach((r: any) => registerRole(orgId, r.name, r.permissions));
  console.debug("[usePermission] registered", roles.length, "roles for", orgId);
}

export function usePermission(organizationId?: string) {
  /* ────────── 1. resolve active role (async) ────────── */
  const [role, setRole] = useState<string | null>(null);   // null ⇒ loading

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = organizationId
          ? await getMember({ organizationId })
          : await authClient.organization.getActiveMember();

        const r = (res?.data?.role ?? "").toLowerCase();
        console.debug("[usePermission] active role =", r);
        !cancelled && setRole(r);
      } catch (err) {
        console.warn("[usePermission] getMember failed:", err);
        !cancelled && setRole("");                          // guest
      }
    })();
    return () => { cancelled = true; };
  }, [organizationId]);

  const loading = role === null;

  /* ────────── 2. local checker, auto-prime on miss ────────── */
  /* A ref so we don’t create a new function instance on every bump */
  const orgIdRef = useRef(organizationId);

  const can = useCallback(
    (perm: Perm): boolean => {
      if (loading) return false;                            // still resolving

      if (role === "owner") return true;                    // owner shortcut

      const orgId = orgIdRef.current ?? "global";
      let grants  = resolveRole({ organizationId: orgId, role: role! });

      // first time we see a miss ⇒ fetch & register roles for that org
      if (!grants && organizationId) {
        console.debug("[usePermission] miss → fetch roles", orgId, role);
        primeRolesOnce(orgId).then(() => {
          // after registration we *might* have the role – force a re-render
          grants = resolveRole({ organizationId: orgId, role: role! });
        });
        return false;                                       // pessimistic
      }

      if (!grants) return false;                            // still missing

      const [resource, actions] = Object.entries(perm)[0];
      const ok = actions.every((a) =>
        ac.can(grants.role).execute(a).on(resource).granted
      );

      console.debug(
        "[usePermission] check",
        orgId + ":" + role,
        perm,
        "→",
        ok
      );
      return ok;
    },
    [loading, role, organizationId]
  );

  /* expose flags (legacy) */
  (can as any).loading = loading;
  (can as any).role    = role;

  return can as typeof can & { loading: boolean; role: string | null };
}
