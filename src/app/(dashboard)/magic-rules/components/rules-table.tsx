"use client";
import { useEffect, useState, startTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, MoreVertical, Search, ToggleLeft, ToggleRight, Trash2, Edit } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

type Rule = {
  id: string;
  name: string;
  event: string;
  priority: number;
  scope: "base" | "supplier" | "both";
  isEnabled: boolean;
  updatedAt: string;
  runOncePerOrder: boolean;
  stopOnMatch: boolean;
};

export function MagicRulesTable() {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [rules, setRules] = useState<Rule[]>([]);
  const [loading, setLoading] = useState(true);

  async function fetchRules() {
    setLoading(true);
    try {
      const res = await fetch(`/api/magic-rules?search=${encodeURIComponent(search)}`);
      if (!res.ok) throw new Error("Failed to fetch rules");
      const data = await res.json();
      setRules(data.rules ?? []);
    } catch (e: any) {
      toast.error(e.message || "Failed to load rules");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { fetchRules(); }, [search]);

  const toggleEnabled = async (r: Rule) => {
    try {
      const res = await fetch(`/api/magic-rules/${r.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isEnabled: !r.isEnabled }),
      });
      if (!res.ok) throw new Error("Failed to update rule");
      toast.success(`${!r.isEnabled ? "Enabled" : "Disabled"} "${r.name}"`);
      fetchRules();
    } catch (e: any) {
      toast.error(e.message || "Update failed");
    }
  };

  const onDelete = async (r: Rule) => {
    if (!confirm(`Delete rule "${r.name}"?`)) return;
    try {
      const res = await fetch(`/api/magic-rules/${r.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Delete failed");
      toast.success("Rule deleted");
      fetchRules();
    } catch (e: any) {
      toast.error(e.message || "Delete failed");
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row justify-between gap-3">
        <form onSubmit={(e) => e.preventDefault()} className="flex w-full sm:w-auto gap-2">
          <div className="relative max-w-sm w-full">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search rules…"
              className="pl-8"
              value={search}
              onChange={(e) => startTransition(() => setSearch(e.target.value))}
            />
          </div>
          <Button type="button" onClick={() => fetchRules()}>Search</Button>
        </form>
        <div className="flex items-center gap-2">
          <Button onClick={() => router.push("/magic-rules/new")}>
            <Plus className="mr-2 h-4 w-4" /> New Rule
          </Button>
        </div>
      </div>

      <div className="rounded-md border overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Event</TableHead>
              <TableHead>Scope</TableHead>
              <TableHead>Priority</TableHead>
              <TableHead>Once?</TableHead>
              <TableHead>Stop?</TableHead>
              <TableHead>Updated</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={8} className="h-24 text-center">Loading…</TableCell></TableRow>
            ) : rules.length === 0 ? (
              <TableRow><TableCell colSpan={8} className="h-24 text-center">No rules found.</TableCell></TableRow>
            ) : rules.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="font-medium flex items-center gap-2">
                  {r.name}
                  {r.isEnabled ? (
                    <Badge variant="secondary">Enabled</Badge>
                  ) : (
                    <Badge variant="outline">Disabled</Badge>
                  )}
                </TableCell>
                <TableCell>{r.event}</TableCell>
                <TableCell>{r.scope}</TableCell>
                <TableCell>{r.priority}</TableCell>
                <TableCell>{r.runOncePerOrder ? "Yes" : "No"}</TableCell>
                <TableCell>{r.stopOnMatch ? "Yes" : "No"}</TableCell>
                <TableCell>{new Date(r.updatedAt).toLocaleString()}</TableCell>
                <TableCell className="text-right">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon">
                        <MoreVertical className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => router.push(`/magic-rules/${r.id}`)}>
                        <Edit className="mr-2 h-4 w-4" /> Edit
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => toggleEnabled(r)}>
                        {r.isEnabled ? (
                          <>
                            <ToggleLeft className="mr-2 h-4 w-4" /> Disable
                          </>
                        ) : (
                          <>
                            <ToggleRight className="mr-2 h-4 w-4" /> Enable
                          </>
                        )}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => onDelete(r)}
                        className="text-destructive focus:text-destructive"
                      >
                        <Trash2 className="mr-2 h-4 w-4" /> Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
