// ─── src/lib/auth/role-registry.ts ─────────────────────────────
import { ac, owner } from "@/lib/permissions";

export const roleRegistry: Record<string, ReturnType<typeof ac.newRole>> = {
  owner,                       // built-in static role
};

export function registerRole(
  orgId: string,
  roleName: string,
  permissions: Record<string, string[]>,
) {
  const key = `${orgId}:${roleName}`;
  if (!roleRegistry[key]) {
    roleRegistry[key] = ac.newRole(permissions);
  }
}
