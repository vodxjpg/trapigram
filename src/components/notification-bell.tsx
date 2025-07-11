// src/components/notification-bell.tsx
"use client";

import { Bell } from "lucide-react";
import { useState } from "react";
import { useRouter } from "next/navigation";
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
  const router = useRouter();

  /* mark a single row */
  const markRead = async (id: string) => {
    await fetch(`/api/in-app-notifications/${id}`, { method: "PATCH" });
    mutate();
  };

  /* mark every row */
  const markAllRead = async () => {
    await fetch("/api/in-app-notifications/mark-all", { method: "PATCH" });
    mutate();
  };

  const handleClick = async (id: string, url?: string | null) => {
    await markRead(id);
    if (url) router.push(url);
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

      {/* scrollable dropdown */}
      <DropdownMenuContent align="end" className="w-80 max-h-96 overflow-y-auto">
        {/* top action */}
        {unreadCount > 0 && (
          <DropdownMenuItem
            onClick={markAllRead}
            className="cursor-pointer font-semibold text-primary"
          >
            Mark all as read
          </DropdownMenuItem>
        )}

        {/* spacer when top action present */}
        {unreadCount > 0 && <hr className="my-1 border-muted" />}

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
                onClick={() => handleClick(n.id, (n as any).url)}
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
