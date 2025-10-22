// src/app/(dashboard)/organizations/[identifier]/platform-keys/page.tsx
"use client";

import { useState, useEffect, useMemo } from "react";
import { useParams } from "next/navigation";
import { toast } from "sonner";

import { authClient } from "@/lib/auth-client";
import { useHasPermission } from "@/hooks/use-has-permission";

// UI
import { Button } from "@/components/ui/button";
import { Dialog, DialogTrigger, DialogContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

// TanStack table + standardized renderer
import { useReactTable, getCoreRowModel, type ColumnDef } from "@tanstack/react-table";
import { StandardDataTable } from "@/components/data-table/data-table";

const TELEGRAM_TOKEN_REGEX = /^[0-9]{7,10}:[A-Za-z0-9_-]{35}$/;

type PlatformKey = {
  id: string;
  platform: string;
  apiKey: string;
};

export default function PlatformKeysPage() {
  const { identifier } = useParams<{ identifier: string }>();

  /* active organisation → id for permission hook */
  const { data: activeOrg } = authClient.useActiveOrganization();
  const organizationId = activeOrg?.id ?? null;

  /* permissions */
  const { hasPermission: canCreate, isLoading: createLoading } =
    useHasPermission(organizationId, { platformKey: ["create"] });
  const { hasPermission: canUpdate, isLoading: updateLoading } =
    useHasPermission(organizationId, { platformKey: ["update"] });
  const { hasPermission: canDelete, isLoading: deleteLoading } =
    useHasPermission(organizationId, { platformKey: ["delete"] });

  /* data state */
  const [keys, setKeys] = useState<PlatformKey[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch(`/api/organizations/${identifier}/platform-keys`, {
        credentials: "include",
      });
      const { platformKeys } = await res.json();
      setKeys(platformKeys ?? []);
    } catch (err) {
      console.error(err);
      toast.error("Failed to load platform keys");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
  }, [identifier]);

  /* dialog state */
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<PlatformKey & { platform: "telegram" | string }>({
    id: "",
    platform: "telegram",
    apiKey: "",
  });

  function edit(key?: PlatformKey) {
    if (key) setForm({ id: key.id, platform: key.platform, apiKey: key.apiKey });
    else setForm({ id: "", platform: "telegram", apiKey: "" });
    setOpen(true);
  }

  async function save() {
    if (form.platform === "telegram" && !TELEGRAM_TOKEN_REGEX.test(form.apiKey)) {
      return toast.error("Invalid Telegram bot key format");
    }
    const method = form.id ? "PATCH" : "POST";
    const res = await fetch(`/api/organizations/${identifier}/platform-keys`, {
      method,
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(form),
    });
    if (!res.ok) {
      const { error } = await res.json().catch(() => ({}));
      return toast.error(error || "Failed to save");
    }
    toast.success("Saved");
    setOpen(false);
    load();
  }

  async function remove(id: string) {
    if (!confirm("Delete this key?")) return;
    const res = await fetch(`/api/organizations/${identifier}/platform-keys`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ id }),
    });
    if (!res.ok) {
      const { error } = await res.json().catch(() => ({}));
      return toast.error(error || "Failed to delete");
    }
    toast.success("Deleted");
    load();
  }

  /* columns for StandardDataTable */
  const columns = useMemo<ColumnDef<PlatformKey>[]>(() => {
    return [
      { accessorKey: "platform", header: "Platform" },
      {
        accessorKey: "apiKey",
        header: "API Key",
        cell: ({ row }) => <span className="font-mono">{row.original.apiKey}</span>,
      },
      {
        id: "actions",
        header: "Actions",
        cell: ({ row }) => {
          const k = row.original;
          return (
            <div className="flex gap-2 justify-start">
              {!updateLoading && canUpdate && (
                <Button size="sm" variant="outline" onClick={() => edit(k)}>
                  Edit
                </Button>
              )}
              {!deleteLoading && canDelete && (
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => remove(k.id)}
                >
                  Delete
                </Button>
              )}
            </div>
          );
        },
      },
    ];
  }, [canUpdate, canDelete, updateLoading, deleteLoading]);

  const table = useReactTable({
    data: keys,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  /* JSX */
  return (
    <div className="container mx-auto py-6 px-6 space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-semibold">Platform Keys</h2>
        {!createLoading && canCreate && (
          <Button onClick={() => edit()}>Add Key</Button>
        )}
      </div>
      <div className="
          [&_table]:table-fixed [&_table]:w-full
          [&_th]:w-1/3 [&_td]:w-1/3
          [&_th]:truncate [&_td]:truncate
        ">
        <StandardDataTable<PlatformKey>
          table={table}
          columns={columns}
          isLoading={loading}
          skeletonRows={6}
          emptyMessage="No platform keys"
        /></div>

      {/* Add / Edit dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger />
        <DialogContent className="space-y-4">
          <h3 className="text-lg font-medium">{form.id ? "Edit Key" : "New Key"}</h3>

          <div className="flex gap-4">
            <button
              type="button"
              onClick={() => setForm((f) => ({ ...f, platform: "telegram" }))}
              className={`flex-1 p-4 border rounded ${form.platform === "telegram"
                ? "border-blue-500 bg-blue-50"
                : "border-gray-300"
                }`}
            >
              Telegram
            </button>
            <div className="flex-1 p-4 border rounded opacity-50 cursor-not-allowed text-center">
              More coming soon
            </div>
          </div>

          <div className="space-y-2">
            <label className="block font-medium">API Key</label>
            <Input
              type="text"
              placeholder="Enter API key"
              value={form.apiKey}
              onChange={(e) => setForm((f) => ({ ...f, apiKey: e.target.value }))}
            />
            {form.platform === "telegram" && (
              <p className="text-sm text-gray-500">
                e.g. <code>123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghi</code>
              </p>
            )}
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={save}>{form.id ? "Update" : "Create"}</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
