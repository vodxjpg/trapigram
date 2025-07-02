// lib/load-org-roles.ts --------------------------------------------------
import { registerDynamicRoles, buildRoles } from "@/lib/permissions";

export async function loadOrgRoles(orgId: string) {
  const res  = await fetch(`/api/organizations/${orgId}/roles`,
                           { credentials:"include" });
  const { roles } = await res.json();          // rows from your GET handler
  const dynamic   = registerDynamicRoles(roles);
  return buildRoles(dynamic);                  // builtin + dynamic
}
