// ─── src/lib/auth/role-resolver.ts (shared by server + client) ───────────
import { roleRegistry } from "./role-registry";
import { owner }        from "@/lib/permissions";

export function resolveRole(
  ctx: { organizationId: string; role: string }
) {
  // 1. owner is always static
  if (ctx.role === "owner") return owner;

  // 2. custom roles are stored under "<orgId>:<role>"
  return roleRegistry[`${ctx.organizationId}:${ctx.role}`];
}
