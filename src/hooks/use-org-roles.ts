// ─── src/hooks/use-org-roles.ts ────────────────────────────────────────────
"use client";

import useSWR                   from "swr";
import { registerRole }         from "@/lib/auth/role-registry";

/**
 * Fetch all custom roles of an organization **and** register them
 * locally so resolveRole() can build fresh Role instances on the client.
 */
export function useOrgRoles(organizationId: string | undefined) {
  /* -------------------------------------------------------------------- */
  /*  Custom fetcher that also updates the registry                        */
  /* -------------------------------------------------------------------- */
  const fetcher = async (): Promise<{ roles: any[] }> => {
    const res  = await fetch(
      `/api/organizations/${organizationId}/roles`,
      { credentials: "include" },
    );
    if (!res.ok) throw new Error("Failed to fetch roles");

    const json = await res.json();                     // { roles: [...] }

    /*  Register every role in the global registry (raw JSON only)        */
    json.roles?.forEach((r: any) =>
      registerRole(organizationId!, r.name, r.permissions),
    );

    return json;
  };

  /* -------------------------------------------------------------------- */
  /*  SWR                                                                 */
  /* -------------------------------------------------------------------- */
  const { data, error, mutate } = useSWR(
    organizationId ? ["orgRoles", organizationId] : null, // key
    fetcher,
  );

  return {
    roles:     data?.roles ?? [],
    isLoading: !data && !error,
    error,
    mutate,
  };
}
