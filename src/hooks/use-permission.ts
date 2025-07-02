// src/hooks/use-permission.ts — (MODIFIED)

"use client";

import { useCallback, useMemo, useEffect, useState } from "react";
import { authClient } from "@/lib/auth-client";
import { getMember } from "@/lib/auth-client/get-member";
import { Permission } from "@/lib/permissions";

// This is our new client-side fetcher
async function checkPermissionOnServer(perm: Permission): Promise<boolean> {
  try {
    const res = await fetch('/api/me/has-permission', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ permissions: perm }),
    });
    if (!res.ok) {
      console.error("Permission check failed:", res.status, await res.text());
      return false;
    }
    const data = await res.json();
    return data.hasPermission || false;
  } catch (error) {
    console.error("Error calling permission check API:", error);
    return false;
  }
}

export function usePermission(organizationId?: string) {
  const [role, setRole] = useState<string | null>(null);
  const [loading, setLoading] = useState(true); // Start as true
  const cache = useMemo(() => new Map<string, boolean>(), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    (async () => {
      try {
        const res = organizationId
          ? await getMember({ organizationId })
          : await authClient.organization.getActiveMember();

        if (cancelled) return;

        const resolvedRole = res?.data?.role || "";
        console.log("[usePermission] Fetched role:", resolvedRole);
        setRole(resolvedRole);
      } catch (err) {
        if (!cancelled) {
          console.warn("[usePermission] failed to load role:", err);
          setRole(""); // Treat as guest/no role
        }
      } finally {
        if (!cancelled) {
            setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [organizationId]);

  const checker = useCallback(
    async (perm: Permission): Promise<boolean> => {
      // Owner always has permission
      if (role === "owner") return true;
      // If we are still fetching the role, we can't know. Default to false.
      if (loading || role === null) return false;
      // Guest/empty role has no permissions
      if (role === "") return false;

      const key = JSON.stringify(perm);
      if (cache.has(key)) {
        return cache.get(key)!;
      }
      
      console.log(`[usePermission] Checking uncached permission for role "${role}":`, perm);
      // Use our new, reliable checker
      const hasPermission = await checkPermissionOnServer(perm);
      cache.set(key, hasPermission);
      console.log(`[usePermission] Result for role "${role}":`, hasPermission);

      return hasPermission;
    },
    [cache, role, loading]
  );
  
  // Return a promise-aware boolean in the component
  const can = (perm: Permission) => {
    // This is a simplified example. For rendering, you'd want to handle the promise.
    // The way you use it in the component is better.
    const key = JSON.stringify(perm);
    return cache.get(key) ?? false;
  }

  // The original structure of your hook was good, let's adapt it.
  // The checker function will be async and components will use `await` or `.then`
  return Object.assign(checker, { loading, role }) as typeof checker & {
    loading: boolean;
    role: string | null;
  };
}