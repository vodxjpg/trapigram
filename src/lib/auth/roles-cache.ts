import { pgPool }          from "@/lib/db";
import { roleRegistry }    from "./role-registry";   // ← same import
import { ac }              from "@/lib/permissions";

type RoleMap = Record<string, ReturnType<typeof ac.newRole>>;

/** mutable module-local cache (one per Node process) */
let cache: Record<string, RoleMap> = {};   // {orgId: {roleName:role}}

export async function primeOrgRoles(orgId: string) {
    const { rows } = await pgPool.query(
      `SELECT name, permissions
         FROM "orgRole"
        WHERE "organizationId" = $1`,
      [orgId],
    );
  
    // refresh   roleRegistry …
    for (const { name, permissions } of rows) {
      roleRegistry[`${orgId}:${name}`] = ac.newRole(permissions);
    }
  
    // …and refresh the local cache (so getRole still works)
    cache[orgId] = Object.fromEntries(
      rows.map(r => [r.name, roleRegistry[`${orgId}:${r.name}`]]),
    );
  }
  
  
  export function getRole(orgId: string, roleName: string) {
    return roleRegistry[`${orgId}:${roleName}`];
  }
  