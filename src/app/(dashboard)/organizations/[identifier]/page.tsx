// src/app/(dashboard)/organizations/[identifier]/page.tsx
"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { authClient } from "@/lib/auth-client"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { useHeaderTitle } from "@/context/HeaderTitleContext";
import { usePermission } from "@/hooks/use-permission";
import { MembersTable } from "./members-table";
import { InvitationsTable } from "./invitations-table";
import { InviteMemberForm } from "./invite-member-form";
import { toast } from "sonner";

type Organization = {
  id: string;
  name: string;
  slug: string;
  memberCount: number;
  userRole: string;
};

export default function OrganizationDetailsPage() {
  const { identifier } = useParams();
  const { setHeaderTitle } = useHeaderTitle();
  const can = usePermission(); 

  const [organization, setOrganization] = useState<Organization | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadOrganization() {
      setLoading(true);
      try {
        const res = await fetch(`/api/organizations/${identifier}`, {
          credentials: "include",
        });
        if (!res.ok) throw new Error(res.statusText);
        const { organization: org } = await res.json();
        setOrganization(org);
        setHeaderTitle(org.name);
        await authClient.organization.setActive({
            organizationId: org.id,
          });
      } catch (err) {
        console.error(err);
        toast.error("Failed to load organization details.");
      } finally {
        setLoading(false);
      }
    }

    if (identifier) loadOrganization();
  }, [identifier, setHeaderTitle]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        Loading…
      </div>
    );
  }

  if (!organization) {
    return (
      <div className="flex items-center justify-center h-full">
        Organization not found
      </div>
    );
  }

  const { id, slug, userRole } = organization;
  const normalizedRole = (userRole ?? "").toLowerCase();
  const isOwner = normalizedRole === "owner"
  const canViewKeys = isOwner || can({ platformKey: ["view"] });

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* Header with Manage Roles & Manage Keys buttons */}
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight">{organization.name}</h1>
        <div className="flex gap-2">
          {isOwner && (
            <Link href={`/organizations/${slug}/roles`}>
              <Button variant="outline">Manage Roles</Button>
            </Link>
          )}
          {canViewKeys && (
            <Link href={`/organizations/${slug}/platform-keys`}>
              <Button variant="outline">Manage Platform Keys</Button>
            </Link>
          )}
        </div>
      </div>

      <p className="text-muted-foreground">
        Manage organization members and invitations.
      </p>

      {/* Invitation form (hook will still double-check permissions) */}
      {can({ invitation: ["create"] }) && (
  <InviteMemberForm organizationId={id} />
)}

      {/* Tabs for Members / Invitations */}
      <Tabs defaultValue="members" className="w-full">
        <TabsList>
          <TabsTrigger value="members">Members</TabsTrigger>
          <TabsTrigger value="invitations">Pending Invitations</TabsTrigger>
        </TabsList>

        <TabsContent value="members" className="mt-4">
          <MembersTable
            organizationId={id}
            organizationSlug={slug}
            currentUserRole={userRole}
          />
        </TabsContent>

        <TabsContent value="invitations" className="mt-4">
          <InvitationsTable
            organizationId={id}
            organizationSlug={slug}
            currentUserRole={userRole}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
