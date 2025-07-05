// src/components/notification-bell.tsx
"use client";

import { Bell } from "lucide-react";
import { useState } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { useNotifications } from "@/hooks/use-notifications";
import { cn } from "@/lib/utils";

/** client-side fallback strip (for old rows) */
const stripTags = (html: string) => html.replace(/<[^>]+>/g, "");

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
          notifications.map((n) => {
            const clean = stripTags(n.title).replace(/\s+/g, " ").trim();
            const txt = clean.length > 64 ? `${clean.slice(0, 61)}…` : clean;
            return (
              <DropdownMenuItem
                key={n.id}
                className={cn("cursor-pointer", !n.read && "font-semibold")}
                onClick={() => markRead(n.id)}
              >
                {txt}
              </DropdownMenuItem>
            );
          })
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
