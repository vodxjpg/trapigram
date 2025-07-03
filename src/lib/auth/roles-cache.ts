/*───────────────────────────────────────────────────────────────────────────
  Load an organisation’s roles from Postgres and refresh the registry
  ───────────────────────────────────────────────────────────────────────────*/

  import { pgPool }       from "@/lib/db";
  import { roleRegistry } from "./role-registry";
  import { ac }           from "@/lib/permissions";
  
  type Role = ReturnType<typeof ac.newRole>;
  type RoleMap = Record<string, Role>;   // { roleName : Role }
  
  /* one per Node process ----------------------------------------------------*/
  const local: Record<string, RoleMap> = {};
  
  /* helper ------------------------------------------------------------------*/
  const log = (...a: unknown[]) => console.debug("[roles-cache]", ...a);
  
  export async function primeOrgRoles(orgId: string) {
    const { rows } = await pgPool.query(
      `SELECT name, permissions
         FROM "orgRole"
        WHERE "organizationId" = $1`,
      [orgId],
    );
  
    log("priming", orgId, "rows:", rows.length);
  
    const map: RoleMap = {};
  
    for (const { name, permissions } of rows) {
      /* build a fresh role for the registry (but we will *clone* it again
         in resolveRole before every authorisation) */
      const roleObj = ac.newRole(permissions);
  
      const key = `${orgId}:${name}`;
      roleRegistry[key] = roleObj;   // global registry used by resolver
      map[name]         = roleObj;   // local (legacy) cache
  
      log("  loaded", key, "→", permissions);
    }
  
    local[orgId] = map;              // replace whole map for that org
  }
  
  /* legacy helper – rarely used now ----------------------------------------*/
  export function getRole(orgId: string, roleName: string) {
    return roleRegistry[`${orgId}:${roleName}`];
  }
  