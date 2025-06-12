// src/hooks/use-permission.ts
"use client";
import { useCallback, useMemo, useEffect, useState } from "react";
import { authClient } from "@/lib/auth-client";

export function usePermission() {
  const [role, setRole] = useState<string>("");

  useEffect(() => {
    authClient.organization
      .getActiveMember()
      .then(({ data }) => setRole(data?.role ?? ""));
  }, []);

  const cache = useMemo(() => new Map<string, boolean>(), [role]);

  return useCallback(
    (perm: Record<string, string[]>) => {
      // **OWNER BYPASS**: always allow everything
      if (role === "owner") return true;

      const key = JSON.stringify(perm);
      if (cache.has(key)) return cache.get(key)!;

      const ok = authClient.organization.checkRolePermission({
        permissions: perm,
        role,
      });
      cache.set(key, ok);
      return ok;
    },
    [cache, role],
  );
}
