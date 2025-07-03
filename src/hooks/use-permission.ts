// ─── src/hooks/use-permission.ts (v4.2 – auto-org-id) ────────────────────
"use client";

import { useCallback, useEffect, useState } from "react";
import { authClient }     from "@/lib/auth-client";
import { getMember }      from "@/lib/auth-client/get-member";
import { resolveRole }    from "@/lib/auth/role-resolver";
import { registerRole }   from "@/lib/auth/role-registry";
import { ac }             from "@/lib/permissions";

type Perm = Record<string, string[]>;

/* ── helper: prime the org-role registry exactly once per org ─────────── */
const primed = new Set<string>();

async function primeRolesOnce(orgId: string) {
  if (primed.has(orgId)) return;
  primed.add(orgId);

  try {
    const res = await fetch(`/api/organizations/${orgId}/roles`, {
      credentials: "include",
    });
    if (!res.ok) {
      console.warn("[usePermission] role fetch failed:", res.status);
      return;
    }
    const { roles } = await res.json();            // [{ name, permissions }]
    roles.forEach((r: any) =>
      registerRole(orgId, r.name, r.permissions),
    );
    console.debug("[usePermission] registered", roles.length, "roles for", orgId);
  } catch (err) {
    console.warn("[usePermission] role fetch exception:", err);
  }
}

/* ── hook ──────────────────────────────────────────────────────────────── */
export function usePermission(passedOrgId?: string) {
  /** `null` ⇒ still loading */
  const [state, setState] = useState<{
    role:  string | null;
    orgId: string | null;
  }>({ role: null, orgId: null });

  /* 1. resolve role + orgId ------------------------------------------------ */
  useEffect(() => {
    let dead = false;

    (async () => {
      try {
        const res = passedOrgId
          ? await getMember({ organizationId: passedOrgId })
          : await authClient.organization.getActiveMember();

        const role  = (res?.data?.role ?? "").toLowerCase();
        const orgId = passedOrgId ?? res?.data?.organizationId ?? "";

        console.debug("[usePermission] active", orgId + ":" + role);
        if (!dead) setState({ role, orgId });

        /* prime registry asap (non-blocking) */
        if (orgId) primeRolesOnce(orgId);
      } catch (err) {
        console.warn("[usePermission] member fetch failed:", err);
        if (!dead) setState({ role: "", orgId: passedOrgId ?? "" }); // guest
      }
    })();

    return () => { dead = true; };
  }, [passedOrgId]);

  const loading = state.role === null;

  /* 2. local checker ------------------------------------------------------- */
  const can = useCallback(
    (perm: Perm): boolean => {
      if (loading) return false;            // still resolving
      if (state.role === "owner") return true;

      const orgId = state.orgId || "global";
      let grants  = resolveRole({ organizationId: orgId, role: state.role! });

      if (!grants) {
        // We haven’t seen roles for this org yet; ensure priming & say “no” for now
        primeRolesOnce(orgId);
        console.debug("[usePermission] miss – no grants yet", orgId, state.role, perm);
        return false;
      }

      const [resource, actions] = Object.entries(perm)[0];
      const ok = actions.every(a =>
        ac.can(grants.role).execute(a).on(resource).granted,
      );

      console.debug(
        "[usePermission] check",
        orgId + ":" + state.role,
        perm,
        "→",
        ok,
      );
      return ok;
    },
    [loading, state.role, state.orgId],
  );

  /* legacy flags on the function object ----------------------------------- */
  (can as any).loading = loading;
  (can as any).role    = state.role;

  return can as typeof can & { loading: boolean; role: string | null };
}
