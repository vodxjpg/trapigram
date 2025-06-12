// src/lib/acl.ts
/* -------------------------------------------------------------------------- */
/*  Convenience wrappers for permission checks                                */
/* -------------------------------------------------------------------------- */

import { auth }       from "@/lib/auth";
import { authClient } from "@/lib/auth-client";

/* ------------------------------ Server side ------------------------------ */
export async function serverHas(
  headers: Headers,
  permissions: Record<string, string[]>,
) {
  const { data, error } = await auth.api.hasPermission({
    headers,
    body: { permissions },
  });
  if (error) throw new Error(error.message);
  return !!data?.allowed;
}

/* ------------------------------ Client side ------------------------------ */
export async function clientHas(
  permissions: Record<string, string[]>,
) {
  const { data, error } = await authClient.organization.hasPermission({
    permissions,
  });
  if (error) throw new Error(error.message);
  return !!data?.allowed;
}
