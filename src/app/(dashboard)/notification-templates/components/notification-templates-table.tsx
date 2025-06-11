// src/app/(dashboard)/notification-templates/components/notification-templates-table.tsx
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import { MoreVertical } from "lucide-react";

interface TemplateRow {
  id: string;
  type: string;
  role: "admin" | "user";
  country: string | null;
  subject: string | null;
  updatedAt: string;
}

export function NotificationTemplatesTable() {
  const [rows, setRows] = useState<TemplateRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/notification-templates", {
          headers: {
            "x-internal-secret":
              process.env.NEXT_PUBLIC_INTERNAL_API_SECRET || "",
          },
        });
        if (!r.ok) throw new Error((await r.json()).error || "fetch failed");
        setRows(await r.json());
      } catch (err: any) {
        toast.error(err.message);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this template? This cannot be undone.")) return;
    try {
      const r = await fetch(`/api/notification-templates/${id}`, {
        method: "DELETE",
        headers: {
          "x-internal-secret":
            process.env.NEXT_PUBLIC_INTERNAL_API_SECRET || "",
        },
      });
      if (!r.ok) throw new Error((await r.json()).error || "delete failed");
      setRows((prev) => prev.filter((t) => t.id !== id));
      toast.success("Template deleted");
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  if (loading) return <div>Loading…</div>;

  return (
    <Card>
      <CardContent className="p-0">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="p-3 text-left">Type</th>
              <th className="p-3 text-left">Role</th>
              <th className="p-3 text-left">Country</th>
              <th className="p-3 text-left">Subject</th>
              <th className="p-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t">
                <td className="p-3">{r.type}</td>
                <td className="p-3 capitalize">{r.role}</td>
                <td className="p-3">{r.country ?? "—"}</td>
                <td className="p-3">{r.subject ?? "—"}</td>
                <td className="p-3 text-right">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-8 w-8">
                        <MoreVertical className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem asChild>
                        <Link href={`/notification-templates/${r.id}/edit`}>
                          Edit
                        </Link>
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onSelect={() => handleDelete(r.id)}
                        className="text-destructive"
                      >
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </td>
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td
                  colSpan={5}
                  className="p-4 text-center text-muted-foreground"
                >
                  No templates yet
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}
