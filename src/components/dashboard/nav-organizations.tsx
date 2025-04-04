"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { IconCirclePlus, IconDotsVertical } from "@tabler/icons-react";
import { authClient } from "@/lib/auth-client";
import { toast } from "sonner";

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
  id: string;
  name: string;
  avatar?: string | null;
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

export function NavOrganizations() {
  const { isMobile } = useSidebar();
  const router = useRouter();

  const [currentOrganization, setCurrentOrganization] = React.useState<Organization | null>(null);
  const [organizations, setOrganizations] = React.useState<Organization[]>([]);
  const [loading, setLoading] = React.useState(true);

  // Fetch organizations and sync active organization on mount
  React.useEffect(() => {
    async function fetchAndSyncOrganizations() {
      try {
        const { data: orgList, error: listError } = await authClient.organization.list();
        if (listError) throw new Error(listError.message);
        setOrganizations(
          orgList.map((org) => ({
            id: org.id,
            name: org.name,
            avatar: org.logo,
          }))
        );

        const { data: activeOrg, error: activeError } = await authClient.organization.getFullOrganization();
        if (activeError) throw new Error(activeError.message);
        if (activeOrg) {
          setCurrentOrganization({
            id: activeOrg.id,
            name: activeOrg.name,
            avatar: activeOrg.logo,
          });
        } else if (orgList.length > 0) {
          setCurrentOrganization({
            id: orgList[0].id,
            name: orgList[0].name,
            avatar: orgList[0].logo,
          });
        }
      } catch (err) {
        console.error("Error fetching organizations:", err);
        toast.error("Failed to load organizations.");
      } finally {
        setLoading(false);
      }
    }
    fetchAndSyncOrganizations();
  }, []);

  // Handle switching organizations from the dropdown
  async function handleSelectOrganization(org: Organization) {
    try {
      await authClient.organization.setActive({ organizationId: org.id });
      setCurrentOrganization(org);
      toast.success(`Switched to ${org.name}`);
      window.location.reload();
    } catch (err) {
      console.error("Error setting active organization:", err);
      toast.error("Failed to switch organization.");
    }
  }

  // Handle "Add organization" click
  function handleAddOrganization() {
    router.push("/organizations");
  }

  // Filter out the active organization from the dropdown list
  const filteredOrganizations = organizations.filter(
    (org) => org.id !== currentOrganization?.id
  );

  if (loading) {
    return (
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton size="lg" disabled>
            <Avatar className="h-8 w-8 rounded-lg grayscale">
              <AvatarFallback className="rounded-lg">??</AvatarFallback>
            </Avatar>
            <div className="grid flex-1 text-left text-sm leading-tight">
              <span className="truncate font-medium">Loading...</span>
            </div>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    );
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
              <Avatar className="h-8 w-8 rounded-lg grayscale">
                <AvatarImage
                  src={currentOrganization?.avatar ?? ""}
                  alt={currentOrganization?.name ?? ""}
                />
                <AvatarFallback className="rounded-lg">
                  {currentOrganization ? getOrganizationInitials(currentOrganization.name) : "??"}
                </AvatarFallback>
              </Avatar>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-medium">
                  {currentOrganization?.name ?? "No Organization"}
                </span>
              </div>
              <IconDotsVertical className="ml-auto size-4" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg"
            side={isMobile ? "bottom" : "right"}
            align="end"
            sideOffset={4}
          >
            <DropdownMenuGroup>
              <DropdownMenuLabel>Switch Organization</DropdownMenuLabel>
              {filteredOrganizations.length === 0 ? (
                <DropdownMenuItem disabled>
                  <span className="text-muted-foreground">No other organizations</span>
                </DropdownMenuItem>
              ) : (
                filteredOrganizations.map((org) => (
                  <DropdownMenuItem
                    key={org.id}
                    onClick={() => handleSelectOrganization(org)}
                  >
                    <Avatar className="mr-2 h-6 w-6 rounded-lg grayscale">
                      <AvatarImage src={org.avatar ?? ""} alt={org.name} />
                      <AvatarFallback className="rounded-lg">
                        {getOrganizationInitials(org.name)}
                      </AvatarFallback>
                    </Avatar>
                    <span>{org.name}</span>
                  </DropdownMenuItem>
                ))
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleAddOrganization}>
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