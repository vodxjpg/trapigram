"use client";

import * as React from "react";
import { IconCirclePlus, IconDotsVertical } from "@tabler/icons-react";

import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";

/** A single organization with an id, name, and optional avatar URL */
type Organization = {
  id: number;
  name: string;
  avatar?: string;
};

/** Utility function to extract up to two initials from an organization name. */
function getOrganizationInitials(name: string) {
  const parts = name.trim().split(/\s+/);
  let initials = "";
  for (const part of parts) {
    if (part.length > 0 && initials.length < 2) {
      initials += part[0].toUpperCase();
    }
  }
  return initials;
}

export function NavOrganizations({ organizations }: { organizations: Organization[] }) {
  const { isMobile } = useSidebar();

  // Store the "current" or "active" organization in state
  const [currentOrganization, setCurrentOrganization] = React.useState<Organization | null>(
    organizations.length > 0 ? organizations[0] : null
  );

  // Handle switching organizations from the dropdown
  function handleSelectOrganization(org: Organization) {
    setCurrentOrganization(org);
    // Additional logic here if needed (e.g. navigation, API call, etc.)
  }

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
            >
              {/* Avatar for the current organization */}
              <Avatar className="h-8 w-8 rounded-lg grayscale">
                <AvatarImage
                  src={currentOrganization?.avatar ?? ""}
                  alt={currentOrganization?.name ?? ""}
                />
                <AvatarFallback className="rounded-lg">
                  {currentOrganization ? getOrganizationInitials(currentOrganization.name) : "??"}
                </AvatarFallback>
              </Avatar>

              {/* Current organization name */}
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-medium">
                  {currentOrganization?.name ?? "No Organization"}
                </span>
              </div>

              {/* Dots icon on the right */}
              <IconDotsVertical className="ml-auto size-4" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>

          {/* The dropdown itself */}
          <DropdownMenuContent
            className="w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg"
            side={isMobile ? "bottom" : "right"}
            align="end"
            sideOffset={4}
          >
            {/* Organizations Section */}
            <DropdownMenuGroup>
              <DropdownMenuLabel>Organizations</DropdownMenuLabel>
              {organizations.map((org) => (
                <DropdownMenuItem
                  key={org.id}
                  onClick={() => handleSelectOrganization(org)}
                >
                  {/* Organization avatar in the dropdown */}
                  <Avatar className="mr-2 h-6 w-6 rounded-lg grayscale">
                    <AvatarImage src={org.avatar ?? ""} alt={org.name} />
                    <AvatarFallback className="rounded-lg">
                      {getOrganizationInitials(org.name)}
                    </AvatarFallback>
                  </Avatar>
                  <span>{org.name}</span>
                  {/* Show the ID on the right */}
                  <span className="ml-auto text-xs text-muted-foreground">
                    #{org.id}
                  </span>
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem>
                <IconCirclePlus className="mr-2 size-4" />
                <span>Add organization</span>
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
