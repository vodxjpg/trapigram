// lib/create-auth-client.ts ---------------------------------------------
import { createAuthClient }   from "better-auth/react";
import { organizationClient } from "better-auth/client/plugins";
import { ac, builtinRoles }   from "@/lib/permissions";
import { loadOrgRoles }       from "./load-org-roles";

export async function makeAuthClient(orgId: string) {
  const roles = await loadOrgRoles(orgId);     // <── new

  return createAuthClient({
    baseURL : `${process.env.NEXT_PUBLIC_APP_URL}/api/auth`,
    fetchOptions: { credentials:"include" },
    plugins: [
      organizationClient({ ac, roles }),
      // …other plugins…
    ],
  });
}
