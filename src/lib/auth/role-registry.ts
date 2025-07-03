/* --------------------------------------------------------
   A tiny in-memory cache of roles that live on the client.
   -------------------------------------------------------- */

   import { ac, owner } from "@/lib/permissions";

   /* ❶  A plain object the plugin expects */
   export const roleRegistry: Record<string, ReturnType<typeof ac.newRole>> = {
     owner,                            // built-in
   };
   
   /* ❷  Call this every time you fetch a custom role */
   export function registerRole(
     organizationId: string,
     roleName: string,
     permissions: Record<string, string[]>,
   ) {
     // “support” in org A ≠ “support” in org B
     const key = `${organizationId}:${roleName}`;
     if (!roleRegistry[key]) {
       roleRegistry[key] = ac.newRole(permissions);
     }
   }
   