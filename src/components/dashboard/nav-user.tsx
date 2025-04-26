"use client";

import * as React from "react";
// import { useRouter } from "next/navigation"; // <-- Removed
import Link from "next/link";
import {
  IconCreditCard,
  IconDotsVertical,
  IconLogout,
  IconNotification,
  IconUserCircle,
} from "@tabler/icons-react";
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
import { authClient } from "@/lib/auth-client";
import { toast } from "sonner";

/** Type for user data */
type User = {
  name: string;
  email: string;
  image?: string | null;
};

export function NavUser() {
  const { isMobile } = useSidebar();
  // const router = useRouter(); // <-- Removed
  const [user, setUser] = React.useState<User | null>(null);
  const [loading, setLoading] = React.useState(true);

  // Fetch user data on mount
  React.useEffect(() => {
    async function fetchUser() {
      try {
        const sessionResponse = await authClient.getSession();
        console.log("Raw session response:", sessionResponse);
        
        if (sessionResponse?.data && "session" in sessionResponse.data && sessionResponse.data.user) {
          const { user: sessionUser } = sessionResponse.data;
          setUser({
            name: sessionUser.name || "Unknown",
            email: sessionUser.email || "No email",
            image: sessionUser.image,
          });
        } else {
          console.warn("Session response lacks expected data:", sessionResponse);
          throw new Error("No active session found");
        }
      } catch (err) {
        console.error("Error fetching user:", err);
        toast.error("Failed to load user data. Please try refreshing the page.");
        setUser({ name: "Error", email: "N/A", image: null });
      } finally {
        setLoading(false);
      }
    }
    fetchUser();
  }, []);

  // Define the sign-out handler
  const handleSignOut = async () => {
    try {
      await authClient.signOut();
      toast.success("Logged out successfully!");
      // router.push("/login"); // <-- Removed
      window.location.href = "/login";
    } catch (err) {
      console.error("Error during sign-out:", err);
      toast.error("Failed to log out.");
    }
  };

  // Navigation handler (removed because we now use <Link>)
  // const handleNavigate = (path: string) => {
  //   console.log("Navigating to:", path);
  //   router.push(path);
  // };

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
              <span className="text-muted-foreground truncate text-xs">...</span>
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
                <AvatarImage src={user?.image ?? ""} alt={user?.name ?? ""} />
                <AvatarFallback className="rounded-lg">
                  {user?.name ? getInitials(user.name) : "??"}
                </AvatarFallback>
              </Avatar>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-medium">{user?.name ?? "No Name"}</span>
                <span className="text-muted-foreground truncate text-xs">
                  {user?.email ?? "No Email"}
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
            <DropdownMenuLabel className="p-0 font-normal">
              <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
                <Avatar className="h-8 w-8 rounded-lg">
                  <AvatarImage src={user?.image ?? ""} alt={user?.name ?? ""} />
                  <AvatarFallback className="rounded-lg">
                    {user?.name ? getInitials(user.name) : "??"}
                  </AvatarFallback>
                </Avatar>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-medium">{user?.name ?? "No Name"}</span>
                  <span className="text-muted-foreground truncate text-xs">
                    {user?.email ?? "No Email"}
                  </span>
                </div>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem asChild>
                <Link href="/settings" className="flex items-center">
                  <IconUserCircle className="mr-2 h-4 w-4" />
                  <span>Account</span>
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link href="/billing" className="flex items-center">
                  <IconCreditCard className="mr-2 h-4 w-4" />
                  <span>Billing</span>
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link href="/notifications" className="flex items-center">
                  <IconNotification className="mr-2 h-4 w-4" />
                  <span>Notifications</span>
                </Link>
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={handleSignOut}>
              <IconLogout className="mr-2 h-4 w-4" />
              <span>Log out</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

/** Utility function to get initials from a name */
function getInitials(name: string) {
  const parts = name.trim().split(/\s+/);
  let initials = "";
  for (const part of parts) {
    if (part.length > 0 && initials.length < 2) {
      initials += part[0].toUpperCase();
    }
  }
  return initials;
}
