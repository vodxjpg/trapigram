// src/app/(dashboard)/organizations/[identifier]/members-table.tsx
"use client";

import { useState, useEffect } from "react";
import { MoreVertical, Trash2, UserCircle } from "lucide-react";
import { toast } from "sonner";
import { useHasPermission } from "@/hooks/use-has-permission";   // ← NEW
import { useOrgRoles } from "@/hooks/use-org-roles";
import { Button } from "@/components/ui/button";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select";

type Member = {
  id: string;
  role: string;
  user: { name: string; email: string };
};

interface Props {
  organizationId: string;
  organizationSlug: string;
  currentUserRole: string | null;
}

export function MembersTable({
  organizationId,
  organizationSlug,
  currentUserRole,
}: Props) {
  /* ── permissions ──────────────────────────────────────────── */
  const {
    hasPermission: canUpdatePerm,
    isLoading:    updateLoading,
  } = useHasPermission(organizationId, { member: ["update_role"] });

  const {
    hasPermission: canDeletePerm,
    isLoading:    deleteLoading,
  } = useHasPermission(organizationId, { member: ["delete"] });

  const canUpdate = currentUserRole === "owner" || canUpdatePerm;
  const canDelete = currentUserRole === "owner" || canDeletePerm;

  /* ── other hooks ───────────────────────────────────────────── */
  const { roles, isLoading: rolesLoading } = useOrgRoles(organizationId);
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);

  /* ── fetch members ─────────────────────────────────────────── */
  async function fetchMembers() {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/organizations/${organizationSlug}/members?organizationId=${organizationId}`,
        { credentials: "include" },
      );
      if (!res.ok) throw new Error("Failed to load members");
      const { members: data } = await res.json();
      setMembers(data);
    } catch (err) {
      console.error(err);
      toast.error("Failed to load members");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchMembers();
  }, [organizationSlug]);

  /* ── helpers ───────────────────────────────────────────────── */
  const allRoles = ["owner", ...roles.map((r) => r.name)];
  const badgeVariant = (role: string) =>
    role === "owner"
      ? "default"
      : role === "manager"
      ? "secondary"
      : "outline";

  async function handleRoleChange(memberId: string, newRole: string) {
    try {
      const res = await fetch(
        `/api/organizations/${organizationSlug}/members/${memberId}?organizationId=${organizationId}`,
        {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ role: newRole }),
        },
      );
      if (res.status === 403) {
        toast.error("You don’t have permission to change roles");
        return;
      }
      if (!res.ok) {
        const { error } = await res.json().catch(() => ({}));
        throw new Error(error || res.statusText);
      }
      toast.success("Role updated");
      fetchMembers();
    } catch (err: any) {
      console.error(err);
      toast.error(err.message || "Failed to update role");
    }
  }

  async function handleRemove(memberId: string, email: string) {
    if (!confirm(`Remove ${email}?`)) return;
    const prev = members;
    setMembers((ms) => ms.filter((m) => m.id !== memberId));
    try {
      const res = await fetch(
        `/api/organizations/${organizationSlug}/members/${memberId}?organizationId=${organizationId}`,
        { method: "DELETE", credentials: "include" },
      );
      if (res.status === 403) {
        toast.error("You don’t have permission to remove members");
        setMembers(prev);
        return;
      }
      if (!res.ok) {
        const { error } = await res.json().catch(() => ({}));
        throw new Error(error || res.statusText);
      }
      toast.success("Member removed");
    } catch (err: any) {
      console.error(err);
      setMembers(prev);
      toast.error(err.message || "Failed to remove member");
    }
  }

  /* ── render ────────────────────────────────────────────────── */
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
                <TableCell className="flex items-center gap-2">
                  <UserCircle className="h-5 w-5 text-muted-foreground" />
                  {m.user.name}
                </TableCell>
                <TableCell>{m.user.email}</TableCell>
                <TableCell>
                  {canUpdate && m.role !== currentUserRole && m.role !== "owner" ? (
                    <Select
                      value={m.role}
                      onValueChange={(v) => handleRoleChange(m.id, v)}
                    >
                      <SelectTrigger className="w-[140px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {allRoles
                          .filter((r) => r !== "owner" && r !== currentUserRole)
                          .map((r) => (
                            <SelectItem key={r} value={r}>
                              {r.charAt(0).toUpperCase() + r.slice(1)}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <Badge variant={badgeVariant(m.role)}>{m.role}</Badge>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  {canDelete && m.role !== currentUserRole && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon">
                          <MoreVertical className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          className="text-destructive"
                          onClick={() => handleRemove(m.id, m.user.email)}
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
