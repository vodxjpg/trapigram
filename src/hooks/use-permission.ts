// ─── src/hooks/use-permission.ts (v4.3 – re-render after priming) ─────────
"use client";

import { useCallback, useEffect, useState } from "react";
import { authClient }     from "@/lib/auth-client";
import { getMember }      from "@/lib/auth-client/get-member";
import { resolveRole }    from "@/lib/auth/role-resolver";
import { registerRole }   from "@/lib/auth/role-registry";

type Perm = Record<string, string[]>;

/* — role-registry priming — */
const primed = new Set<string>();
async function primeRolesOnce(orgId: string): Promise<boolean> {
  if (primed.has(orgId)) return false;          // nothing new
  primed.add(orgId);

  try {
    const res = await fetch(`/api/organizations/${orgId}/roles`, {
      credentials: "include",
    });
    if (!res.ok) return false;

    const { roles } = await res.json();
    roles.forEach((r: any) => registerRole(orgId, r.name, r.permissions));
    console.debug("[usePermission] registered", roles.length, "roles for", orgId);
    return true;                                // new roles were added
  } catch (err) {
    console.warn("[usePermission] role fetch failed:", err);
    return false;
  }
}

export function usePermission(passedOrgId?: string) {
  const [{ role, orgId }, setUser] = useState<{ role: string | null; orgId: string | null }>({
    role: null,
    orgId: null,
  });
  const [tick, bump] = useState(0);             // ← forces re-render

  /* 1. resolve user & org -------------------------------------------------- */
  useEffect(() => {
    let dead = false;
    (async () => {
      try {
        const res  = passedOrgId
          ? await getMember({ organizationId: passedOrgId })
          : await authClient.organization.getActiveMember();

        const r  = (res?.data?.role ?? "").toLowerCase();
        const id = passedOrgId ?? res?.data?.organizationId ?? "";
        console.debug("[usePermission] active", id + ":" + r);

        if (!dead) setUser({ role: r, orgId: id });
        if (id) primeRolesOnce(id).then(added => added && bump(v => v + 1));
      } catch (err) {
        console.warn("[usePermission] member fetch failed:", err);
        if (!dead) setUser({ role: "", orgId: passedOrgId ?? "" });
      }
    })();
    return () => { dead = true; };
  }, [passedOrgId]);

  const loading = role === null;

  /* 2. checker ------------------------------------------------------------- */
  const can = useCallback((perm: Perm): boolean => {
    if (loading) return false;
    if (role === "owner") return true;

    const oid   = orgId || "global";
    const grant = resolveRole({ organizationId: oid, role: role! });

    if (!grant) {
      // ensure roles are primed and schedule re-eval if something new arrived
      primeRolesOnce(oid).then(added => added && bump(v => v + 1));
      console.debug("[usePermission] miss – no grants", oid, role, perm);
      return false;
    }
    const [resource, actions] = Object.entries(perm)[0];
       const allowed = (grant as any)[resource];
       const ok = actions.every(a =>
         Array.isArray(allowed)          //   { order: ["view", …] }
           ? allowed.includes(a)
           : allowed?.[a] === true       //   { order: { view:true } }
       );
    console.debug("[usePermission] check", oid + ":" + role, perm, "→", ok);
    return ok;
  }, [loading, role, orgId, tick]);             // ← re-run after bump

  (can as any).loading = loading;
  (can as any).role    = role;
  (can as any).version  = tick;
  return can as typeof can & { loading: boolean; role: string | null };
}
