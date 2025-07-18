"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { toast } from "sonner";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { IconLogout } from "@tabler/icons-react";

// Utility function to get initials from organization name
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

export default function SelectOrganizationPage() {
  const router = useRouter();
  const [organizations, setOrganizations] = React.useState<any[]>([]);
  const [loading, setLoading] = React.useState(true);

  // Fetch the user's organizations on mount
  React.useEffect(() => {
    async function fetchOrganizations() {
      try {
        const { data, error } = await authClient.organization.list();
        if (error) {
          toast.error("Failed to load organizations: " + error.message);
          return;
        }
        setOrganizations(data || []);
      } catch (err) {
        console.error("Error fetching organizations:", err);
        toast.error("An error occurred while loading organizations.");
      } finally {
        setLoading(false);
      }
    }
    fetchOrganizations();
  }, []);

  // Handle selecting a organization
  async function handleSelectOrganization(orgId: string) {
    try {
      await authClient.organization.setActive({ organizationId: orgId });
      toast.success("Organization activated!");
      router.push("/dashboard");
    } catch (err) {
      console.error("Error setting active organization:", err);
      toast.error("Failed to activate organization.");
    }
  }

  // Handle logout
  async function handleLogout() {
    try {
      await authClient.signOut();
      toast.success("Logged out successfully!");
      router.push("/login");
    } catch (err) {
      console.error("Error during logout:", err);
      toast.error("Failed to log out.");
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen p-4">
        <p>Loading organizations...</p>
      </div>
    );
  }

  if (organizations.length === 0) {
    return (
      <div className="flex items-center justify-center min-h-screen p-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>No Organizations</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground">
              You don’t have any organizations yet. Please contact support.
            </p>
            <Button variant="link" onClick={handleLogout} className="mt-4">
              <IconLogout className="mr-2 h-4 w-4" />
              Log out
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-screen p-4 bg-background">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Select an Organization</CardTitle>
          <p className="text-sm text-muted-foreground">
            Choose an organization to continue
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          {organizations.map((org) => (
            <Button
              key={org.id}
              variant="outline"
              className="w-full flex items-center justify-start p-2 h-auto"
              onClick={() => handleSelectOrganization(org.id)}
            >
              <Avatar className="h-8 w-8 rounded-lg grayscale mr-3">
                <AvatarImage src={org.logo ?? ""} alt={org.name} />
                <AvatarFallback className="rounded-lg">
                  {getOrganizationInitials(org.name)}
                </AvatarFallback>
              </Avatar>
              <div className="text-left flex-1">
                <span className="font-medium">{org.name}</span>
                <p className="text-xs text-muted-foreground">#{org.id}</p>
              </div>
            </Button>
          ))}
        </CardContent>
      </Card>
      <Button
        variant="link"
        onClick={handleLogout}
        className="mt-6 hover:text-foreground text-red-700"
      >
        <IconLogout className="mr-2 h-4 w-4" />
        Log out
      </Button>
    </div>
  );
}