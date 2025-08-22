// src/app/(dashboard)/organizations/[identifier]/roles/page.tsx
"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Pencil, Trash } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useOrgRoles } from "@/hooks/use-org-roles";
import { registerRole } from "@/lib/auth/role-registry";   // ← NEW
import RoleDialog from "./role-dialog";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
export default function RolesPage() {
  const { identifier: orgId } = useParams<{ identifier: string }>();
  const router = useRouter();
  const { roles, isLoading, mutate } = useOrgRoles(orgId);

  /* ------------------------------------------------------------------ */
/*  Prime the client-side role registry every time `roles` changes    */
/* ------------------------------------------------------------------ */
useEffect(() => {
  if (!roles?.length) return;
  roles.forEach(r => registerRole(orgId, r.name, r.permissions));
}, [orgId, roles]);


  const [dialogRole, setDialogRole] = useState<any | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<any | null>(null);

  async function deleteRole(roleId: string) {
    await fetch(`/api/organizations/${orgId}/roles`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ roleId }),
      credentials: "include",
    });
    mutate();
  }

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => router.back()}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <h1 className="text-2xl font-bold flex-1">Roles &amp; Permissions</h1>
        <Button onClick={() => setDialogRole({})}>New Role</Button>
      </div>

      {isLoading ? (
        <p>Loading…</p>
      ) : (
        <ul className="divide-y border rounded-md bg-white shadow-sm">
          {roles.map((r: any) => (
            <li key={r.id} className="p-4 flex justify-between items-start">
              <div>
                <span className="capitalize font-medium">{r.name}</span>
                
              </div>
              <div className="flex gap-3">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setDialogRole(r)}
                >
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setConfirmDelete(r)}
                >
                  <Trash className="h-4 w-4" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* Create / Edit Dialog */}
      <Dialog
        open={!!dialogRole}
        onOpenChange={(v) => !v && setDialogRole(null)}
      >
        {dialogRole && (
          <RoleDialog
            organizationId={orgId}
            existing={dialogRole.id ? dialogRole : undefined}
            onSaved={() => {
              mutate();
              setDialogRole(null);
            }}
          />
        )}
      </Dialog>

      {/* Delete confirmation */}
      <Dialog
        open={!!confirmDelete}
        onOpenChange={(v) => !v && setConfirmDelete(null)}
      >
        {confirmDelete && (
          <DialogContent className="bg-white p-6 rounded-md">
            <p className="mb-4">
              Delete role <b>{confirmDelete.name}</b>? This cannot be undone.
            </p>
            <div className="flex justify-end gap-3">
              <Button
                variant="secondary"
                onClick={() => setConfirmDelete(null)}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={async () => {
                  await deleteRole(confirmDelete.id);
                  setConfirmDelete(null);
                }}
              >
                Delete
              </Button>
            </div>
          </DialogContent>
        )}
      </Dialog>
    </div>
  );
}
