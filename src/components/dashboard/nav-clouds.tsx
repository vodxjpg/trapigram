// /src/components/nav-clouds.tsx
"use client";

import * as React from "react";
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from "@/components/ui/collapsible"; // Ensure these point to your UI primitives
import {
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarMenuSub,
  SidebarMenuSubItem,
} from "@/components/ui/sidebar";

type NavCloudItem = {
  title: string;
  url?: string;
  icon?: React.ElementType;
  items?: { title: string; url: string }[];
};

export function NavClouds({ items }: { items: NavCloudItem[] }) {
  return (
    <SidebarMenu>
      {items.map((item) => {
        // Render collapsible menu for items with submenus
        if (item.items && item.items.length > 0) {
          return (
            <Collapsible key={item.title}>
              <SidebarMenuItem>
                <CollapsibleTrigger asChild>
                  <SidebarMenuButton tooltip={item.title}>
                    {item.icon && <item.icon />}
                    <span>{item.title}</span>
                  </SidebarMenuButton>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <SidebarMenuSub>
                    {item.items.map((subItem) => (
                      <SidebarMenuSubItem key={subItem.title}>
                        <a href={subItem.url}>{subItem.title}</a>
                      </SidebarMenuSubItem>
                    ))}
                  </SidebarMenuSub>
                </CollapsibleContent>
              </SidebarMenuItem>
            </Collapsible>
          );
        }
        // Render a normal menu item if no subitems exist
        return (
          <SidebarMenuItem key={item.title}>
            <a href={item.url}>
              <SidebarMenuButton tooltip={item.title}>
                {item.icon && <item.icon />}
                <span>{item.title}</span>
              </SidebarMenuButton>
            </a>
          </SidebarMenuItem>
        );
      })}
    </SidebarMenu>
  );
}
