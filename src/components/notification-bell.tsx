// src/components/notification-bell.tsx
"use client";

import { Bell } from "lucide-react";
import { useState } from "react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { useNotifications } from "@/hooks/use-notifications";
import { cn } from "@/lib/utils";

export function NotificationBell() {
  const { notifications, unreadCount, isLoading, mutate } = useNotifications();
  const [closing, setClosing] = useState(false);

  const markRead = async (id: string) => {
    await fetch(`/api/in-app-notifications/${id}`, { method: "PATCH" });
    mutate();
  };

  return (
    <DropdownMenu onOpenChange={(o) => setClosing(!o && closing)}>
      <DropdownMenuTrigger
        className="relative rounded-full p-2 hover:bg-muted focus:outline-none"
        aria-label="Notifications"
      >
        <Bell className="h-5 w-5" />
        {unreadCount > 0 && (
          <Badge
            variant="destructive"
            className="absolute -right-1 -top-1 h-4 min-w-[1rem] animate-pulse px-1 py-0 text-[0.65rem] leading-none"
          >
            {unreadCount > 99 ? "99+" : unreadCount}
          </Badge>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        {isLoading ? (
          <DropdownMenuItem disabled>Loading…</DropdownMenuItem>
        ) : notifications.length === 0 ? (
          <DropdownMenuItem disabled>No notifications</DropdownMenuItem>
        ) : (
          notifications.map((n) => (
            <DropdownMenuItem
              key={n.id}
              className={cn("cursor-pointer", !n.read && "font-semibold")}
              onClick={() => markRead(n.id)}
            >
              {n.title.length > 64 ? `${n.title.slice(0, 61)}…` : n.title}
            </DropdownMenuItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
