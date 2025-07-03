// src/hooks/use-has-permission.ts
import useSWR from 'swr';

type Permissions = {
  [resource: string]: string[];
};

// The fetcher function that calls our new API endpoint
const permissionFetcher = async (url: string, permissions: Permissions) => {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ permissions }),
    credentials: 'include',
  });

  if (!res.ok) {
    throw new Error('An error occurred while fetching permissions.');
  }

  const data = await res.json();
  return data.hasPermission as boolean;
};

export function useHasPermission(organizationId: string | null, permissions: Permissions) {
  // We stringify the permissions to create a stable SWR key.
  const permissionsKey = JSON.stringify(permissions);
  const key = organizationId ? [`/api/organizations/${organizationId}/permissions/check`, permissionsKey] : null;

  const { data, error } = useSWR(
    key,
    ([url, permsKey]) => permissionFetcher(url, JSON.parse(permsKey)),
    // Optional: add some configuration
    {
      shouldRetryOnError: false,
      revalidateOnFocus: false,
    }
  );

  return {
    hasPermission: data ?? false, // Default to false if data is not yet available
    isLoading: !error && data === undefined,
    error,
  };
}