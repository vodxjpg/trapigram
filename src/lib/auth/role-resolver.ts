/* ─── src/lib/auth/role-resolver.ts ────────────────────────────────────────
   Resolves a `{organizationId, role}` pair to the corresponding ac.Role.
   Runs on BOTH the server (inside better-auth) and the browser (via
   organizationClient).  Added verbose logging to see exactly which role
   object is picked every time the access-control engine calls us.          */

   import { roleRegistry } from "./role-registry";
   import { owner }        from "@/lib/permissions";
   
   /** Helper so we don’t spam production logs */
   const dbg = (...args: unknown[]) => {
     if (process.env.NODE_ENV !== "production")
       console.debug("[resolveRole]", ...args);
   };
   
   export function resolveRole(
     ctx: { organizationId: string; role: string }
   ) {
     /* 1) Owner is always static */
     if (ctx.role === "owner") {
       dbg("owner → static role");
       return owner;
     }
   
     /* 2) Look-up dynamic roles under "<orgId>:<role>" */
     const key  = `${ctx.organizationId}:${ctx.role}`;
     const role = roleRegistry[key];
   
     dbg(
       "org =", ctx.organizationId,
       "role =", ctx.role,
       "key =", key,
       "→", role ? "FOUND" : "NOT FOUND",
       role?.statements ?? "-"
     );
   
     return role;         // may be undefined → better-auth will reject
   }
   