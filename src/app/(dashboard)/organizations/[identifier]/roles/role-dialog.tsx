// src/app/(dashboard)/organizations/[identifier]/roles/role-dialog.tsx
"use client";

import { useState, useEffect, useMemo } from "react";
import { authClient } from "@/lib/auth-client"; 
import { DialogContent }             from "@/components/ui/dialog";
import { Button }                    from "@/components/ui/button";
import { Input }                     from "@/components/ui/input";
import { Checkbox }                  from "@/components/ui/checkbox";
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from "@/components/ui/accordion";
import { statements }                from "@/lib/permissions";
import { cleanPermissions }          from "@/lib/utils/cleanPermissions";
import { resourceLabels, actionLabels } from "@/lib/permissionLabels";

export default function RoleDialog({
  organizationId,
  existing,
  onSaved,
}: {
  organizationId: string;
  existing?: { id: string; name: string; permissions: Record<string,string[]> };
  onSaved: () => void;
}) {
  const [name, setName]     = useState(existing?.name || "");
  const [perms, setPerms]   = useState<Record<string,string[]>>(existing?.permissions || {});
  const [filter, setFilter] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (existing) {
      setName(existing.name);
      setPerms(existing.permissions);
    }
  }, [existing]);

  const toggle = (res: string, act: string) => {
    setPerms(prev => {
      const setActs = new Set(prev[res] || []);
      setActs.has(act) ? setActs.delete(act) : setActs.add(act);
      return { ...prev, [res]: Array.from(setActs) };
    });
  };

  // Which resources match the user’s filter?
  const visibleResources = useMemo(() =>
    Object.keys(statements)
      .filter(r => resourceLabels[r]?.toLowerCase().includes(filter.toLowerCase()))
  , [filter]);

  async function save() {
    if (!name) return;
    setSaving(true);
    const cleaned = cleanPermissions(perms);
    const method  = existing ? "PATCH" : "POST";
    const res     = await fetch(`/api/organizations/${organizationId}/roles`, {
      method,
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        roleId:      existing?.id,
        name,
        permissions: cleaned,
      }),
    });
    setSaving(false);
    if (res.ok) onSaved();
    authClient.organization.invalidatePermissionCache?.();
  }

  return (
    <DialogContent
      className={`
        bg-white p-6 rounded-md overflow-auto
        w-[95vw] sm:w-[90vw] md:w-[80vw] lg:w-[60vw] xl:w-[50vw]
        max-h-[90vh] mx-auto
      `}
    >
      <h2 className="text-xl font-semibold mb-4">
        {existing ? "Edit Role" : "Create Role"}
      </h2>

      <Input
        placeholder="Role name"
        value={name}
        onChange={e => setName(e.target.value)}
        className="mb-4"
      />

      <Input
        placeholder="Filter resources…"
        value={filter}
        onChange={e => setFilter(e.target.value)}
        className="mb-6"
      />

      <Accordion type="multiple" className="space-y-2">
        {visibleResources.map(res => (
          <AccordionItem key={res} value={res} className="border rounded">
            <AccordionTrigger className="py-2 px-4 font-medium">
              {resourceLabels[res] ?? res}
            </AccordionTrigger>
            <AccordionContent className="p-4 bg-gray-50">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                {statements[res].map(act => {
                  const checked = perms[res]?.includes(act) ?? false;
                  return (
                    <label key={act} className="flex items-center gap-2 text-sm">
                      <Checkbox
                        checked={checked}
                        onCheckedChange={() => toggle(res, act)}
                      />
                      {actionLabels[act] ?? act}
                    </label>
                  );
                })}
              </div>
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>

      <div className="mt-6 flex justify-end">
        <Button disabled={saving || !name} onClick={save}>
          {saving ? "Saving…" : existing ? "Update" : "Save"}
        </Button>
      </div>
    </DialogContent>
  );
}
