/*───────────────────────────────────────────────────────────────────────────
  Global registry               (shared client + server)
  ───────────────────────────────────────────────────────────────────────────*/

  import { ac, owner } from "@/lib/permissions";

  /** We keep only the *raw* JSON permissions here */
  export const roleRegistry: Record<string, Record<string, string[]>> = {
    owner: {},                                    // useless, but reserved
  };
  
  /** called on the client after GET /roles */
  export function registerRole(
    orgId: string,
    roleName: string,
    permissions: Record<string, string[]>,
  ) {
    roleRegistry[`${orgId}:${roleName}`] = permissions;
  }
  
  /** helper – build a fresh Role every time */
  export function buildRole(perm: Record<string, string[]> | undefined) {
    return perm ? ac.newRole(perm) : undefined;
  }
  