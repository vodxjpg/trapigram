/*───────────────────────────────────────────────────────────────────────────
  Resolve => fresh Role
  ───────────────────────────────────────────────────────────────────────────*/
  import { roleRegistry, buildRole } from "./role-registry";
  import { owner }                   from "@/lib/permissions";
  
  const log = (...a: unknown[]) => console.debug("[resolveRole]", ...a);
  
  export function resolveRole(
    ctx: { organizationId: string; role: string }
  ) {
    if (ctx.role === "owner") return owner;               // static
  
    const key  = `${ctx.organizationId}:${ctx.role}`;
    const perm = roleRegistry[key];
  
    log("→", key, perm);
  
    return buildRole(perm);                               // may be undefined
  }
  