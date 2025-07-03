import { ac }     from "@/lib/permissions";   // only the STATEMENTS!
import { pgPool } from "@/lib/db";

type RoleMap = Record<string, ReturnType<typeof ac.newRole>>;

/** mutable module-local cache (one per Node process) */
let cache: Record<string, RoleMap> = {};   // {orgId: {roleName:role}}

export async function primeOrgRoles(orgId: string) {
  const res = await pgPool.query(
    `SELECT name, permissions FROM "orgRole" WHERE "organizationId"=$1`, [orgId]
  );

  const map: RoleMap = {};
  for (const row of res.rows) {
    map[row.name] = ac.newRole(row.permissions); // build runtime role
  }
  cache[orgId] = map;
}

export function getRole(orgId: string, roleName: string) {
  return cache[orgId]?.[roleName];        // undefined → “role unknown”
}
