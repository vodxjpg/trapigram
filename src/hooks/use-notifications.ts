// src/hooks/use-notifications.ts
"use client";

import useSWR from "swr";

export interface NotificationSummary {
  id: string;
  title: string;
  read: boolean;
  createdAt: string; // ISO
}

type ApiResponse = {
  notifications: NotificationSummary[];
  unreadCount: number;
};

const fetcher = (url: string) => fetch(url).then((r) => r.json() as Promise<ApiResponse>);

export function useNotifications(limit = 10) {
  const { data, isLoading, mutate } = useSWR<ApiResponse>(
    `/api/in-app-notifications?limit=${limit}`,
    fetcher,
    { refreshInterval: 30_000 }, // 30 s live update
  );

  return {
    notifications: data?.notifications ?? [],
    unreadCount: data?.unreadCount ?? 0,
    isLoading,
    mutate,
  };
}
