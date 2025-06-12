// src/app/(dashboard)/organizations/[identifier]/members-table.tsx
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
  organizationSlug: string;
  currentUserRole: string | null;
}

export function MembersTable({
  organizationId,
  organizationSlug,
  currentUserRole,
}: MembersTableProps) {
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchMembers = async () => {
    setLoading(true);
    try {
      const resp = await fetch(
        `/api/organizations/${organizationSlug}/members?organizationId=${organizationId}`,
        { credentials: "include" }
      );
      if (!resp.ok) throw new Error(resp.statusText);
      const { members } = await resp.json();
      setMembers(members);
     
    } catch (err) {
      console.error(err);
      toast.error("Failed to load members");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (organizationSlug) fetchMembers();
  }, [organizationSlug]);

    // owner can touch any non-owner; manager can touch any non-owner
    const canChangeRole = (m: Member) => {
      if (currentUserRole === "owner")   return m.role !== "owner";
      if (currentUserRole === "manager") return m.role !== "owner";
      return false;
    };
    const canRemoveMember = canChangeRole;

  const getSelectableRoles = () => {
    if (currentUserRole === "owner") {
      const alreadyOwner = members.some((m) => m.role === "owner");
      return alreadyOwner
        ? ["manager", "accountant", "employee"]
        : ["owner", "manager", "accountant", "employee"];
    }
    if (currentUserRole === "manager")
      return ["manager", "accountant", "employee"];
    return [];
  };

  const handleRoleChange = async (memberId: string, newRole: string) => {
    try {
      const resp = await fetch(
        `/api/organizations/${organizationSlug}/members/${memberId}?organizationId=${organizationId}`,
        {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ role: newRole }),
        }
      );
      if (!resp.ok) {
        const { error } = await resp.json().catch(() => ({}));
        throw new Error(error || resp.statusText);
      }
      toast.success("Role updated");
      fetchMembers();
    } catch (err: any) {
      console.error(err);
      toast.error("Failed to update role: " + err.message);
    }
  };

  const handleRemoveMember = async (memberId: string, email: string) => {
    if (!confirm(`Remove ${email}?`)) return;
    try {
      const resp = await fetch(
        `/api/organizations/${organizationSlug}/members/${memberId}?organizationId=${organizationId}`,
        {
          method: "DELETE",
          credentials: "include",
        }
      );
      if (!resp.ok) {
        const { error } = await resp.json().catch(() => ({}));
        throw new Error(error || resp.statusText);
      }
      toast.success(`Removed ${email}`);
      fetchMembers();
    } catch (err: any) {
      console.error(err);
      toast.error("Failed to remove member: " + err.message);
    }
  };

  const badgeVariant = (role: string) => {
    switch (role) {
      case "owner":
        return "default";
      case "manager":
        return "secondary";
      default:
        return "outline";
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
                Loading…
              </TableCell>
            </TableRow>
          ) : members.length === 0 ? (
            <TableRow>
              <TableCell colSpan={4} className="h-24 text-center">
                No members
              </TableCell>
            </TableRow>
          ) : (
            members.map((m) => (
              <TableRow key={m.id}>
                <TableCell className="font-medium flex items-center gap-2">
                  <UserCircle className="h-5 w-5 text-muted-foreground" />
                  {m.user.name}
                </TableCell>
                <TableCell>{m.user.email}</TableCell>
                <TableCell>
                  {canChangeRole(m) ? (
                    <Select
                      value={m.role}
                      onValueChange={(v) => handleRoleChange(m.id, v)}
                    >
                      <SelectTrigger className="w-[120px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {getSelectableRoles().map((r) => (
                          <SelectItem key={r} value={r}>
                            {r.charAt(0).toUpperCase() + r.slice(1)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <Badge variant={badgeVariant(m.role)}>
                      {m.role}
                    </Badge>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  {canRemoveMember(m) && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon">
                          <MoreVertical className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onClick={() =>
                            handleRemoveMember(m.id, m.user.email)
                          }
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
