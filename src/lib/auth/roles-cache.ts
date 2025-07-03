/* ─── src/lib/auth/roles-cache.ts ──────────────────────────────────────────
   Keeps the server-side roleRegistry in sync with the "orgRole" table.
   Added detailed logs so we can see exactly what permissions are loaded
   from the DB and when.                                                    */

   import { pgPool }       from "@/lib/db";
   import { roleRegistry } from "./role-registry";
   import { ac }           from "@/lib/permissions";
   
   type Role = ReturnType<typeof ac.newRole>;
   type RoleMap = Record<string, Role>;        // { roleName : Role }
   
   /** module-local cache (one per Node process) */
   let cache: Record<string, RoleMap> = {};    // { orgId : RoleMap }
   
   const dbg = (...args: unknown[]) => {
     if (process.env.NODE_ENV !== "production")
       console.debug("[roles-cache]", ...args);
   };
   
   /* ───────────────────────── primeOrgRoles ──────────────────────────
      Reads ALL roles of one organisation from Postgres and refreshes
      both `roleRegistry` (global) and our local `cache`.               */
   export async function primeOrgRoles(orgId: string) {
     const { rows } = await pgPool.query(
       `SELECT name, permissions
          FROM "orgRole"
         WHERE "organizationId" = $1`,
       [orgId],
     );
   
     dbg("priming roles for", orgId, "— rows =", rows.length);
   
     const map: RoleMap = {};
   
     for (const { name, permissions } of rows) {
       dbg("  loading", name, "→", permissions);
       const key  = `${orgId}:${name}`;
       const role = ac.newRole(permissions);
   
       roleRegistry[key] = role;   // global registry (used by resolveRole)
       map[name]         = role;   // local cache
     }
   
     cache[orgId] = map;           // replace the whole map for that org
   }
   
   /* ─────────────────────────  getRole (optional) ─────────────────────────── */
   export function getRole(orgId: string, roleName: string) {
     /* NOTE: this is *only* used by older code paths.
              resolveRole() now reads directly from roleRegistry.             */
     return roleRegistry[`${orgId}:${roleName}`];
   }
   