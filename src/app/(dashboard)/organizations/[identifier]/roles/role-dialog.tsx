// src/app/(dashboard)/organizations/[identifier]/roles/role-dialog.tsx
"use client";

import { useState, useEffect } from "react";
import { DialogContent } from "@radix-ui/react-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { statements } from "@/lib/permissions";
import { cleanPermissions } from "@/lib/utils/cleanPermissions";

type Props = {
  organizationId: string;
  onSaved: () => void;
  existing?: { id: string; name: string; permissions: Record<string, string[]> };
};

export default function RoleDialog({ organizationId, onSaved, existing }: Props) {
  const [name, setName] = useState("");
  const [perms, setPerms] = useState<Record<string, string[]>>({});
  const [saving, setSaving] = useState(false);

  /* preload in edit mode */
  useEffect(() => {
    if (existing) {
      setName(existing.name);
      setPerms(existing.permissions);
    }
  }, [existing]);

  function toggle(res: string, act: string) {
    setPerms((prev) => {
      const cur = new Set(prev[res] ?? []);
      cur.has(act) ? cur.delete(act) : cur.add(act);
      return { ...prev, [res]: Array.from(cur) };
    });
  }

  async function save() {
    if (!name) return;
    setSaving(true);
    const filtered = cleanPermissions(perms); 
    const method = existing ? "PATCH" : "POST";
    const res = await fetch(`/api/organizations/${organizationId}/roles`, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ roleId: existing?.id, name, permissions: filtered }),
     
      credentials: "include",
    });
    setSaving(false);
    if (res.ok) onSaved();
  }

  return (
    <DialogContent className="bg-white p-6 rounded-md max-h-[80vh] overflow-y-auto">
      <h2 className="font-semibold text-lg mb-4">
        {existing ? "Edit Role" : "Create Role"}
      </h2>

      <Input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Role name"
        className="mb-6"
      />

      <div className="space-y-4">
        {Object.entries(statements).map(([res, acts]) => (
          <fieldset key={res} className="border rounded-md p-3">
            <legend className="font-medium capitalize">{res}</legend>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mt-2">
              {acts.map((a) => {
                const checked = perms[res]?.includes(a);
                return (
                  <label key={a} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={checked}
                      onCheckedChange={() => toggle(res, a)}
                    />
                    {a}
                  </label>
                );
              })}
            </div>
          </fieldset>
        ))}
      </div>

      <div className="mt-6 flex justify-end">
        <Button disabled={saving || !name} onClick={save}>
          {saving ? "Saving…" : existing ? "Update" : "Save"}
        </Button>
      </div>
    </DialogContent>
  );
}
