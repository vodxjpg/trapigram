// /src/components/nav-unified.tsx
"use client";

import * as React from "react";
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from "@/components/ui/collapsible";
import {
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarMenuSub,
  SidebarMenuSubItem,
} from "@/components/ui/sidebar";

export type NavItem = {
  title: string;
  url?: string;
  icon?: React.ElementType;
  items?: { title: string; url: string }[];
};

export function NavUnified({ items }: { items: NavItem[] }) {
  return (
    <SidebarMenu>
      {items.map((item) =>
        item.items && item.items.length > 0 ? (
          <Collapsible key={item.title}>
            <div className={item.title}>
              <SidebarMenuItem>
                <CollapsibleTrigger asChild>
                  <SidebarMenuButton tooltip={item.title}>
                    {item.icon && <item.icon />}
                    <span className="text-black">{item.title}</span>
                  </SidebarMenuButton>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <SidebarMenuSub>
                    {item.items.map((subItem) => (
                      <SidebarMenuSubItem key={subItem.title}>
                        <a className="text-sm" href={subItem.url}>
                          {subItem.title}
                        </a>
                      </SidebarMenuSubItem>
                    ))}
                  </SidebarMenuSub>
                </CollapsibleContent>
              </SidebarMenuItem>
            </div>
          </Collapsible>
        ) : (
          <div key={item.title} className={item.title}>
            <SidebarMenuItem key={item.title}>
              <a href={item.url}>
                <SidebarMenuButton tooltip={item.title}>
                  {item.icon && <item.icon />}
                  <span>{item.title}</span>
                </SidebarMenuButton>
              </a>
            </SidebarMenuItem>
          </div>
        )
      )}
    </SidebarMenu>
  );
}
