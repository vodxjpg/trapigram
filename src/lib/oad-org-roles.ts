// src/lib/load-org-roles.ts
import { registerDynamicRoles, buildRoles } from "@/lib/permissions";

/** Return builtin + dynamic roles for a given organisation. */
export async function loadOrgRoles(orgId: string | null) {
  // No org yet (sign-in / marketing pages) → just return the built-ins
  if (!orgId) return import("@/lib/permissions").then(m => m.builtinRoles);

  const res   = await fetch(`/api/organizations/${orgId}/roles`,
                            { credentials:"include" });
  const { roles } = await res.json();             // from your GET handler
  const dynamic   = registerDynamicRoles(roles);  // build Role objects
  return buildRoles(dynamic);                     // merge with built-ins
}
