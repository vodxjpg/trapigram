// src/app/(dashboard)/discount-rules/components/discount-rules-table.tsx
"use client";

import { useEffect, useState, startTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  MoreVertical,
  Trash2,
  Edit,
} from "lucide-react";

import { useDebounce } from "@/hooks/use-debounce";
import { authClient } from "@/lib/auth-client";
import { useHasPermission } from "@/hooks/use-has-permission";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";

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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";

import { toast } from "sonner";

/* ------------------------------------------------------------------ */
/*  Types                                                             */
/* ------------------------------------------------------------------ */
type Step = { fromUnits: number; toUnits: number; price: number };
type ProdItem = { productId: string | null; variationId: string | null };

type TierPricing = {
  id: string;
  name: string;
  countries: string[];
  active: boolean;
  steps: Step[];
  products: ProdItem[];
  // New preferred field
  clients?: string[];
  // Legacy fallback
  customers?: string[];
};

type Client = {
  id: string;
  firstName?: string;
  lastName?: string;
  username?: string;
  email?: string;
  country?: string;
};

/* ------------------------------------------------------------------ */
/*  Component                                                         */
/* ------------------------------------------------------------------ */
export function DiscountRulesTable() {
  const router = useRouter();

  /* ── org & permissions ────────────────────────────────────────── */
  const { data: activeOrg } = authClient.useActiveOrganization();
  const orgId = activeOrg?.id ?? null;

  const { hasPermission: canView, isLoading: viewLoading } = useHasPermission(
    orgId,
    { tierPricing: ["view"] }
  );
  const { hasPermission: canUpdate, isLoading: updateLoading } =
    useHasPermission(orgId, { tierPricing: ["update"] });
  const { hasPermission: canDelete, isLoading: deleteLoading } =
    useHasPermission(orgId, { tierPricing: ["delete"] });

  /* ── state ─────────────────────────────────────────────────────── */
  const [rules, setRules] = useState<TierPricing[]>([]);
  const [loading, setLoading] = useState(true);

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [totalPages, setTotalPages] = useState(1);

  // search with debounce
  const [query, setQuery] = useState("");
  const debounced = useDebounce(query, 300);

  const [ruleToDelete, setRuleToDelete] = useState<TierPricing | null>(null);

  // client cache (id -> Client) so we can show "First Last (username)" in table
  const [clientsById, setClientsById] = useState<Record<string, Client>>({});

  /* ── redirect if no view ───────────────────────────────────────── */
  useEffect(() => {
    if (!viewLoading && !canView) router.replace("/discount-rules");
  }, [viewLoading, canView, router]);

  /* ── fetch rules ───────────────────────────────────────────────── */
  const fetchRules = async () => {
    if (!canView) return;
    setLoading(true);
    try {
      const qs = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
        search: debounced,
      });
      const res = await fetch(`/api/tier-pricing?${qs.toString()}`);
      if (!res.ok) throw new Error();
      const {
        tierPricings,
        totalPages: tp = 1,
        currentPage,
      } = await res.json();
      setRules(tierPricings);
      setTotalPages(tp);
      if (currentPage) setPage(currentPage);
    } catch {
      toast.error("Failed to load tier-pricing rules");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!viewLoading) fetchRules();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewLoading, page, pageSize, debounced]);

  /* ── fetch clients once so we can resolve labels in the table ──── */
  useEffect(() => {
    // only fetch if we have at least one rule referencing clients
    const hasAnyClient =
      rules.find((r) => (r.clients ?? r.customers ?? []).length > 0) != null;
    if (!hasAnyClient) return;

    (async () => {
      try {
        // Load a large page to cover most cases; fallback to IDs if some are missing.
        const res = await fetch(`/api/clients?page=1&pageSize=500`, {
          headers: {
            "x-internal-secret": process.env.NEXT_PUBLIC_INTERNAL_API_SECRET || "",
          },
        });
        if (!res.ok) return; // show IDs if it fails
        const json = await res.json();
        const list: Client[] = Array.isArray(json.clients) ? json.clients : [];
        if (list.length) {
          setClientsById((prev) => {
            const next = { ...prev };
            for (const c of list) next[c.id] = c;
            return next;
          });
        }
      } catch {
        // non-fatal; we’ll just show raw IDs for any unresolved ones
      }
    })();
  }, [rules]);

  /* ── handlers ──────────────────────────────────────────────────── */
  const handleSearchSubmit = (e: FormEvent) => e.preventDefault();

  const confirmDelete = async () => {
    if (!ruleToDelete) return;
    try {
      await fetch(`/api/tier-pricing/${ruleToDelete.id}`, { method: "DELETE" });
      toast.success("Deleted");
      setRuleToDelete(null);
      fetchRules();
    } catch {
      toast.error("Delete failed");
    }
  };

  const toggleActive = async (rule: TierPricing) => {
    if (!canUpdate) return;
    try {
      await fetch(`/api/tier-pricing/${rule.id}/active`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: !rule.active }),
      });
      setRules((prev) =>
        prev.map((r) => (r.id === rule.id ? { ...r, active: !r.active } : r))
      );
    } catch {
      toast.error("Failed to update status");
    }
  };

  /* ── helpers ───────────────────────────────────────────────────── */
  const getRuleClientIds = (r: TierPricing) => (r.clients ?? r.customers ?? []).filter(Boolean);

  const formatClient = (c?: Client) => {
    if (!c) return "";
    const name = `${c.firstName ?? ""} ${c.lastName ?? ""}`.trim();
    if (name && c.username) return `${name} (${c.username})`;
    return name || c.username || c.email || c.id;
  };

  const clientLabelById = (id: string) => formatClient(clientsById[id]) || id;

  const renderCustomersChips = (ids?: string[]) => {
    const arr = Array.isArray(ids) ? ids : [];
    if (arr.length === 0) return <span>All</span>;

    const shown = arr.slice(0, 2);
    const extra = arr.length - shown.length;

    return (
      <div className="flex flex-wrap items-center gap-1">
        {shown.map((id) => (
          <Badge key={id} variant="outline" className="max-w-[220px] truncate">
            {clientLabelById(id)}
          </Badge>
        ))}
        {extra > 0 && (
          <span className="text-xs text-muted-foreground whitespace-nowrap">
            +{extra} more
          </span>
        )}
      </div>
    );
  };

  /* ── guards ────────────────────────────────────────────────────── */
  if (viewLoading || !canView) return null;

  /* ── JSX ───────────────────────────────────────────────────────── */
  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row justify-between gap-4">
        <form
          onSubmit={handleSearchSubmit}
          className="flex w-full sm:w-auto gap-2"
        >
          <Input
            placeholder="Search rules…"
            className="pl-8 w-full"
            value={query}
            onChange={(e) =>
              startTransition(() => {
                setQuery(e.target.value);
                setPage(1);
              })
            }
          />
          <Button type="submit">Search</Button>
        </form>
      </div>

      {/* Table */}
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Active</TableHead>
              <TableHead>Countries</TableHead>
              <TableHead>Customers</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={5} className="h-24 text-center">
                  Loading…
                </TableCell>
              </TableRow>
            ) : rules.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="h-24 text-center">
                  No tier-pricing rules.
                </TableCell>
              </TableRow>
            ) : (
              rules.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">{r.name}</TableCell>
                  <TableCell>
                    <Switch
                      checked={r.active}
                      onCheckedChange={() => toggleActive(r)}
                      disabled={!canUpdate}
                    />
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {r.countries.map((c) => (
                        <Badge key={c} variant="outline">
                          {c}
                        </Badge>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell>
                    {renderCustomersChips(getRuleClientIds(r))}
                  </TableCell>
                  <TableCell className="text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon">
                          <MoreVertical className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {canUpdate && !updateLoading && (
                          <DropdownMenuItem
                            onClick={() =>
                              router.push(`/discount-rules/${r.id}`)
                            }
                          >
                            <Edit className="mr-2 h-4 w-4" />
                            Edit
                          </DropdownMenuItem>
                        )}
                        {canDelete && !deleteLoading && (
                          <DropdownMenuItem
                            className="text-destructive"
                            onClick={() => setRuleToDelete(r)}
                          >
                            <Trash2 className="mr-2 h-4 w-4" />
                            Delete
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between">
        <div className="text-sm text-muted-foreground">
          Page {page} of {totalPages}
        </div>
        <div className="flex items-center space-x-2">
          <p className="text-sm font-medium">Rows</p>
          <Select
            value={pageSize.toString()}
            onValueChange={(v) =>
              startTransition(() => {
                setPageSize(Number(v));
                setPage(1);
              })
            }
          >
            <SelectTrigger className="h-8 w-[70px]">
              <SelectValue placeholder={pageSize.toString()} />
            </SelectTrigger>
            <SelectContent side="top">
              {[5, 10, 20, 50].map((n) => (
                <SelectItem key={n} value={n.toString()}>
                  {n}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Button
            variant="outline"
            size="icon"
            disabled={page === 1}
            onClick={() => setPage(1)}
          >
            <ChevronsLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            disabled={page === 1}
            onClick={() => setPage((p) => p - 1)}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            disabled={page === totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            disabled={page === totalPages}
            onClick={() => setPage(totalPages)}
          >
            <ChevronsRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Delete dialog */}
      <AlertDialog
        open={!!ruleToDelete}
        onOpenChange={(o) => !o && setRuleToDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this tier-pricing rule?</AlertDialogTitle>
            <AlertDialogDescription>
              Permanently delete “{ruleToDelete?.name}”?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
