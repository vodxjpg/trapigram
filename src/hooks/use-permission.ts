// src/hooks/use-permission.ts
"use client";
import { useCallback, useMemo, useEffect, useState } from "react";
import { authClient } from "@/lib/auth-client";

export function usePermission() {
  const [role, setRole] = useState<string | null>(null); // null = still loading

  useEffect(() => {
    authClient.organization
      .getActiveMember()
      .then(({ data }) => setRole(data?.role ?? ""))
      .catch(() => setRole(""))    // on error, treat as no role
  }, []);

    // loading if role === null
    const loading = role === null;
 

  const cache = useMemo(() => new Map<string, boolean>(), [role]);

  return useCallback(
    (perm: Record<string, string[]>) => {
      // **OWNER BYPASS**: always allow everything
      if (role === "owner") return true;

      // if still loading, optimistically allow UI to render
      if (loading) return true;


      const key = JSON.stringify(perm);
      if (cache.has(key)) return cache.get(key)!;

      const ok = authClient.organization.checkRolePermission({
        permissions: perm,
        role,
      });
      cache.set(key, ok);
      return ok;
    },
    [cache, role, loading],
  );
}
