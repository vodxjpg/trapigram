/*───────────────────────────────────────────────────────────────────────────
  Prime roles from Postgres
  ───────────────────────────────────────────────────────────────────────────*/
  import { pgPool }              from "@/lib/db";
  import { roleRegistry }        from "./role-registry";
  
  const log = (...a: unknown[]) => console.debug("[roles-cache]", ...a);
  
  export async function primeOrgRoles(orgId: string) {
    const { rows } = await pgPool.query(
      `SELECT name, permissions
         FROM "orgRole"
        WHERE "organizationId" = $1`,
      [orgId],
    );
  
    log("priming", orgId, "rows:", rows.length);
  
    for (const { name, permissions } of rows) {
      roleRegistry[`${orgId}:${name}`] = permissions;      // raw JSON only
      log("  loaded", name, "→", permissions);
    }
  }
  
  /* legacy helper -----------------------------------------------------------*/
  export function getRole(orgId: string, roleName: string) {
    return roleRegistry[`${orgId}:${roleName}`];
  }
  