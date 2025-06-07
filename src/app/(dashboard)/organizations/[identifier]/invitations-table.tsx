// src/app/(dashboard)/organizations/[slug]/invitations-table.tsx
"use client";

import { useState, useEffect } from "react";
import { MoreVertical, Trash2, Mail } from "lucide-react";
import { toast } from "sonner";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";

type Invitation = {
  id: string;
  email: string;
  role: string;
  status: "pending" | "accepted" | "rejected" | "canceled";
  expiresAt: string;
};

interface InvitationsTableProps {
  organizationId: string;
  organizationSlug: string;
  currentUserRole: string | null;
}

export function InvitationsTable({ organizationId, organizationSlug, currentUserRole }: InvitationsTableProps) {
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchInvitations = async () => {
    if (!organizationSlug) {
      console.log("Skipping fetch: organizationSlug is undefined");
      return;
    }
    setLoading(true);
    try {
      const response = await fetch(`/api/organizations/${organizationSlug}/invitations`, {
        headers: {
          "x-internal-secret": process.env.NEXT_PUBLIC_INTERNAL_API_SECRET || "",
        },
      });
      if (!response.ok) {
        throw new Error(`Failed to fetch invitations: ${response.status} ${response.statusText}`);
      }
      const { invitations } = await response.json();
      setInvitations(invitations);
    } catch (error) {
      console.error("Error fetching invitations:", error);
      toast.error("Failed to load invitations");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchInvitations();
  }, [organizationSlug]);

  const canCancel = (inv: Invitation) => {
    if (!currentUserRole) return false;
    if (currentUserRole === "owner") return true;
    if (currentUserRole === "manager") {
      return inv.role !== "owner";
    }
    return false;
  };

  const handleCancelInvitation = async (invitationId: string, email: string) => {
    if (!confirm(`Are you sure you want to cancel the invitation to ${email}?`)) return;
    try {
      await authClient.organization.cancelInvitation({ invitationId });
      toast.success(`Invitation to ${email} canceled`);
      fetchInvitations();
    } catch (error) {
      console.error("Error canceling invitation:", error);
      toast.error("Failed to cancel invitation");
    }
  };

  const formatDate = (dateString: string) => {
    if (!dateString || typeof dateString !== "string") {
      return "Invalid Date";
    }
    const date = new Date(dateString);
    if (isNaN(date.getTime())) {
      return "Invalid Date";
    }
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    }).format(date);
  };

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Email</TableHead>
            <TableHead>Role</TableHead>
            <TableHead>Expires</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {loading ? (
            <TableRow>
              <TableCell colSpan={4} className="h-24 text-center">
                Loading...
              </TableCell>
            </TableRow>
          ) : invitations.length === 0 ? (
            <TableRow>
              <TableCell colSpan={4} className="h-24 text-center">
                No pending invitations.
              </TableCell>
            </TableRow>
          ) : (
            invitations.map((invitation) => (
              <TableRow key={invitation.id}>
                <TableCell className="font-medium">
                  <div className="flex items-center gap-2">
                    <Mail className="h-4 w-4 text-muted-foreground" />
                    {invitation.email}
                  </div>
                </TableCell>
                <TableCell>
                  <Badge variant="outline">
                    {invitation.role.charAt(0).toUpperCase() + invitation.role.slice(1)}
                  </Badge>
                </TableCell>
                <TableCell>{formatDate(invitation.expiresAt)}</TableCell>
                <TableCell className="text-right">
                  {canCancel(invitation) && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon">
                          <MoreVertical className="h-4 w-4" />
                          <span className="sr-only">Open menu</span>
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onClick={() => handleCancelInvitation(invitation.id, invitation.email)}
                          className="text-destructive focus:text-destructive"
                        >
                          <Trash2 className="mr-2 h-4 w-4" />
                          Cancel Invitation
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}