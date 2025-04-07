// /home/zodx/Desktop/trapigram/src/app/(dashboard)/organizations/[slug]/members-table.tsx
"use client";

import { useState, useEffect } from "react";
import { MoreVertical, Trash2, UserCircle } from "lucide-react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type Member = {
  id: string;
  userId: string;
  role: string;
  user: { id: string; name: string; email: string };
};

interface MembersTableProps {
  organizationId: string;
  currentUserRole: string | null;
}

export function MembersTable({ organizationId, currentUserRole }: MembersTableProps) {
  const [members, setMembers] = useState<Member[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchMembers = async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/internal/organization/${organizationId}/members`, {
        credentials: "include", // This sends cookies with the request
        headers: {
          "x-internal-secret": "XwObNL2ZSW9CCQJhSsKY90H5RHyhdj3p", // Replace with your actual INTERNAL_API_SECRET from .env
        },
      });
      if (!response.ok) {
        throw new Error(`Failed to fetch members: ${response.status} ${response.statusText}`);
      }
      const { members } = await response.json();
      setMembers(members);
      const { data: session } = await authClient.session.get();
      if (session?.user?.id) setCurrentUserId(session.user.id);
    } catch (error) {
      console.error("Error fetching members:", error);
      toast.error("Failed to load members");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMembers();
  }, [organizationId]);

  const canChangeRole = (member: Member) => {
    if (!currentUserRole || !currentUserId) return false;
    if (currentUserRole === "owner") return member.userId !== currentUserId; // Owner can’t demote themselves
    if (currentUserRole === "manager") {
      return member.role !== "owner" && member.userId !== currentUserId; // Manager can’t change Owner or self
    }
    return false;
  };

  const canRemoveMember = (member: Member) => {
    if (!currentUserRole || !currentUserId) return false;
    if (currentUserRole === "owner") return member.userId !== currentUserId; // Owner can’t remove self
    if (currentUserRole === "manager") {
      return member.role !== "owner" && member.userId !== currentUserId; // Manager can’t remove Owner or self
    }
    return false;
  };

  const getSelectableRoles = () => {
    if (currentUserRole === "owner") return ["owner", "manager", "accountant", "employee"];
    if (currentUserRole === "manager") return ["manager", "accountant", "employee"];
    return [];
  };

  const handleRemoveMember = async (memberId: string, email: string) => {
    if (!confirm(`Are you sure you want to remove ${email}?`)) return;
    try {
      await authClient.organization.removeMember({ memberIdOrEmail: memberId, organizationId });
      toast.success(`Removed ${email}`);
      fetchMembers();
    } catch (error) {
      console.error("Error removing member:", error);
      toast.error("Failed to remove member");
    }
  };

  const handleRoleChange = async (memberId: string, newRole: string) => {
    try {
      await authClient.organization.updateMemberRole({ memberId, role: newRole });
      toast.success("Role updated");
      fetchMembers();
    } catch (error) {
      console.error("Error updating role:", error);
      toast.error("Failed to update role");
    }
  };

  const getRoleBadgeVariant = (role: string) => {
    switch (role) {
      case "owner": return "default";
      case "manager": return "secondary";
      default: return "outline";
    }
  };

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Email</TableHead>
            <TableHead>Role</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {loading ? (
            <TableRow>
              <TableCell colSpan={4} className="h-24 text-center">Loading...</TableCell>
            </TableRow>
          ) : members.length === 0 ? (
            <TableRow>
              <TableCell colSpan={4} className="h-24 text-center">No members found.</TableCell>
            </TableRow>
          ) : (
            members.map((member) => (
              <TableRow key={member.id}>
                <TableCell className="font-medium">
                  <div className="flex items-center gap-2">
                    <UserCircle className="h-5 w-5 text-muted-foreground" />
                    {member.user.name}
                  </div>
                </TableCell>
                <TableCell>{member.user.email}</TableCell>
                <TableCell>
                  {canChangeRole(member) ? (
                    <Select value={member.role} onValueChange={(value) => handleRoleChange(member.id, value)}>
                      <SelectTrigger className="w-[120px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {getSelectableRoles().map((role) => (
                          <SelectItem key={role} value={role}>
                            {role.charAt(0).toUpperCase() + role.slice(1)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <Badge variant={getRoleBadgeVariant(member.role)}>{member.role}</Badge>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  {canRemoveMember(member) && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon">
                          <MoreVertical className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onClick={() => handleRemoveMember(member.id, member.user.email)}
                          className="text-destructive"
                        >
                          <Trash2 className="mr-2 h-4 w-4" /> Remove
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