// src/hooks/use-org-roles.ts
"use client";
import useSWR from "swr";

export function useOrgRoles(organizationId: string) {
  const fetcher = (url: string) =>
    fetch(url, { credentials: "include" }).then((r) => r.json());

  const { data, error, mutate } = useSWR(
    organizationId ? `/api/organizations/${organizationId}/roles` : null,
    fetcher,
  );

  return {
    roles: data?.roles ?? [],
    isLoading: !data && !error,
    error,
    mutate,
  };
}
