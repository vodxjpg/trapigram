/*───────────────────────────────────────────────────────────────────────────
  Resolve { organizationId, role } ➜ Role
  ───────────────────────────────────────────────────────────────────────────*/

  import { roleRegistry } from "./role-registry";
  import { ac, owner }    from "@/lib/permissions";
  
  /** log helper – always on so we see it in Vercel */
  const log = (...args: unknown[]) =>
    console.debug("[resolveRole]", ...args);
  
  export function resolveRole(
    ctx: { organizationId: string; role: string }
  ) {
    /* 1 ) owner is static */
    if (ctx.role === "owner") {
      log("owner → static role");
      return owner;
    }
  
    /* 2 ) dynamic roles live under "<orgId>:<roleName>" */
    const key      = `${ctx.organizationId}:${ctx.role}`;
    const cached   = roleRegistry[key];           // may be undefined
  
    if (!cached) {
      log("MISSING", key);
      return undefined as any;                    // let better-auth 403
    }
  
    /* 3 ) clone **every time** to avoid memo-pollution */
    // @ts-ignore “statements” is not public but exists.
    const fresh = ac.newRole({ ...cached.statements });
  
    log(
      key,
      "→ statements",
      cached.statements,
      "⇢ new clone created"
    );
  
    return fresh;
  }
  