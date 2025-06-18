// src/hooks/use-user.ts
"use client";

import useSWR from "swr";

export interface User {
  id: string;
  email: string;
  name: string | null;
  phone: string | null;
  country: string | null;
  is_guest: boolean | null;
  emailVerified: boolean | null;
  image: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

const fetcher = async (url: string) => {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error("Failed to fetch current user");
  }
  const json = await res.json();
  // our API returns { user: { … } }
  return json.user as User | null;
};

export function useUser() {
  const { data, error, isValidating } = useSWR<User | null>(
    "/api/users/current",   // ← point at your new route
    fetcher
  );
  return {
    user: data,
    isLoading: (!error && !data) || isValidating,
    error,
  };
}
