// /home/zodx/Desktop/trapigram/src/app/(dashboard)/organizations/[slug]/members-table.tsx
"use client"

import { useState, useEffect } from "react"
import { MoreVertical, Trash2, UserCircle } from "lucide-react"
import { toast } from "sonner"
import { authClient } from "@/lib/auth-client"

import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Badge } from "@/components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

type Member = {
  id: string
  userId: string
  role: string
  user: {
    id: string
    name: string
    email: string
  }
}

interface MembersTableProps {
  organizationId: string
}

export function MembersTable({ organizationId }: MembersTableProps) {
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentUserRole, setCurrentUserRole] = useState<string | null>(null);

  const fetchMembers = async () => {
    setLoading(true);
    try {
      const { data: membersData, error: membersError } = await authClient.organization.getMembers({
        organizationId,
      });
      if (membersError) throw new Error(membersError.message);
      setMembers(membersData);

      const { data: activeMember, error: activeMemberError } = await authClient.organization.getActiveMember();
      if (activeMemberError) throw new Error(activeMemberError.message);
      setCurrentUserRole(activeMember.role);
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

  const handleRemoveMember = async (memberId: string, email: string) => {
    if (!confirm(`Are you sure you want to remove ${email} from this organization?`)) return;
    try {
      await authClient.organization.removeMember({
        memberIdOrEmail: memberId,
        organizationId,
      });
      toast.success(`Member ${email} removed successfully`);
      fetchMembers();
    } catch (error) {
      console.error("Error removing member:", error);
      toast.error("Failed to remove member");
    }
  };

  const handleRoleChange = async (memberId: string, newRole: string) => {
    try {
      await authClient.organization.updateMemberRole({
        memberId,
        role: newRole,
      });
      toast.success("Member role updated successfully");
      fetchMembers();
    } catch (error) {
      console.error("Error updating member role:", error);
      toast.error("Failed to update member role");
    }
  };

  const canChangeRole = (memberRole: string) => {
    if (currentUserRole === "owner") return true;
    if (currentUserRole === "manager") return memberRole !== "owner" && memberRole !== "manager";
    return false;
  };

  const getRoleBadgeVariant = (role: string) => {
    switch (role) {
      case "owner": return "default";
      case "manager": return "secondary";
      case "accountant": return "outline";
      case "employee": return "outline";
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
              <TableCell colSpan={4} className="h-24 text-center">
                Loading...
              </TableCell>
            </TableRow>
          ) : members.length === 0 ? (
            <TableRow>
              <TableCell colSpan={4} className="h-24 text-center">
                No members found.
              </TableCell>
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
                  {canChangeRole(member.role) ? (
                    <Select
                      value={member.role}
                      onValueChange={(value) => handleRoleChange(member.id, value)}
                    >
                      <SelectTrigger className="w-[120px]">
                        <SelectValue placeholder="Select role" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="owner">Owner</SelectItem>
                        <SelectItem value="manager">Manager</SelectItem>
                        <SelectItem value="accountant">Accountant</SelectItem>
                        <SelectItem value="employee">Employee</SelectItem>
                      </SelectContent>
                    </Select>
                  ) : (
                    <Badge variant={getRoleBadgeVariant(member.role)}>{member.role}</Badge>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  {member.role !== "owner" && currentUserRole !== "employee" && currentUserRole !== "accountant" && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon">
                          <MoreVertical className="h-4 w-4" />
                          <span className="sr-only">Open menu</span>
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onClick={() => handleRemoveMember(member.id, member.user.email)}
                          className="text-destructive focus:text-destructive"
                        >
                          <Trash2 className="mr-2 h-4 w-4" />
                          Remove
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