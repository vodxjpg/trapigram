// src/hooks/use-set-active-org.ts
"use client";
import { useEffect } from "react";
import { authClient } from "@/lib/auth-client";

/**
 * Whenever `organizationId` (or slug) changes, update the session’s
 * active organization.  Runs only on the client.
 */
export function useSetActiveOrg(organizationId?: string, isSlug = false) {
  useEffect(() => {
    if (!organizationId) return;

    authClient.organization.setActive(
      isSlug ? { organizationSlug: organizationId }
             : { organizationId }
    ).catch(() => {
      // Ignore — worst case the session keeps its previous value.
    });
  }, [organizationId, isSlug]);
}
