// src/app/(dashboard)/tickets/components/ticket-table.tsx
"use client";

import React, { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import {
  Search,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  MoreVertical,
  Eye,
  RotateCcw,
  Plus,
  Tags,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogClose,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import ReactSelect from "react-select";
import CreatableSelect from "react-select/creatable";

/* Standard data-table (TanStack) */
import { StandardDataTable } from "@/components/data-table/data-table";
import {
  ColumnDef,
  getCoreRowModel,
  useReactTable,
  createColumnHelper,
} from "@tanstack/react-table";

type Ticket = {
  id: string;
  title: string;
  priority: "low" | "medium" | "high";
  status: "open" | "in-progress" | "closed";
  createdAt: string;
  ticketKey: number;
  // 👇 needed for the customer line under the title
  clientId: string;
  firstName?: string | null;
  lastName?: string | null;
  username?: string | null;
};

export function TicketsTable() {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [tagsMap, setTagsMap] = useState<Record<string, string[]>>({});
  const [loading, setLoading] = useState(true);

  const [totalPages, setTotalPages] = useState(1);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [search, setSearch] = useState("");

  const [allTags, setAllTags] = useState<{ value: string; label: string }[]>(
    []
  );
  const [selectedTags, setSelectedTags] = useState<
    { value: string; label: string }[]
  >([]);
  const [priorityFilter, setPriorityFilter] = useState<
    "all" | "low" | "medium" | "high"
  >("all");
  const [statusFilter, setStatusFilter] = useState<
    "all" | "open" | "in-progress" | "closed"
  >("all");

  // ── NEW: edit-tags dialog state for the table ────────────────────────────
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingTicket, setEditingTicket] = useState<{ id: string; title: string } | null>(null);
  const [editTags, setEditTags] = useState<{ value: string; label: string }[]>([]);
  const [savingTags, setSavingTags] = useState(false);

  useEffect(() => {
    fetch("/api/tickets/tags")
      .then(async (res) => {
        if (!res.ok) throw new Error("Failed to fetch tags");
        return await res.json();
      })
      .then(({ tags }) => {
        setAllTags(
          tags.map((t: { description: string }) => ({
            value: t.description,
            label: t.description,
          }))
        );
      })
      .catch(() => {
        toast.error("Could not load tag filters");
      });
  }, []);

  const fetchTickets = async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams({
        page: String(currentPage),
        pageSize: String(pageSize),
        search,
      });
      const res = await fetch(`/api/tickets?${qs}`);
      if (!res.ok) throw new Error();
      const { tickets, totalPages, currentPage: cur } = await res.json();
      setTickets(tickets);
      setTotalPages(totalPages);
      setCurrentPage(cur);

      const pairs = await Promise.all(
        tickets.map(async (t: Ticket) => {
          const r = await fetch(`/api/tickets/${t.id}/tags`);
          if (!r.ok) throw new Error();
          const { tags } = await r.json();
          return [t.id, tags.map((tg: any) => tg.description)] as const;
        })
      );
      setTagsMap(Object.fromEntries(pairs));
    } catch {
      toast.error("Failed to load tickets or tags");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTickets();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPage, pageSize, search]);

  const filtered = useMemo(() => {
    return tickets.filter((t) => {
      if (priorityFilter !== "all" && t.priority !== priorityFilter) return false;
      if (statusFilter !== "all" && t.status !== statusFilter) return false;
      if (selectedTags.length) {
        const myTags = tagsMap[t.id] || [];
        if (!selectedTags.every((st) => myTags.includes(st.value))) return false;
      }
      return true;
    });
  }, [tickets, priorityFilter, statusFilter, selectedTags, tagsMap]);

  async function reopenTicket(ticketId: string) {
    try {
      const res = await fetch(`/api/tickets/${ticketId}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "in-progress", reopen: true }),
      });
      if (!res.ok) throw new Error();
      toast.success("Status set to in-progress");
      setTickets((prev) =>
        prev.map((t) =>
          t.id === ticketId ? { ...t, status: "in-progress" } : t
        )
      );
    } catch {
      toast.error("Failed to update status");
    }
  }

  // ── NEW: open the edit-tags dialog for a ticket ──────────────────────────
  const openTagsDialog = (ticket: { id: string; title: string }) => {
    const current = (tagsMap[ticket.id] || []).map((d) => ({ value: d, label: d }));
    setEditingTicket(ticket);
    setEditTags(current);
    setEditDialogOpen(true);
  };

  // ── NEW: save tags for the current ticket ────────────────────────────────
  const saveTagsForTicket = async () => {
    if (!editingTicket) return;
    try {
      setSavingTags(true);
      const tags = editTags.map((t) => t.value);
      const res = await fetch(`/api/tickets/${editingTicket.id}/tags`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tags }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to save tags");
      }

      // update tags map for this row
      setTagsMap((prev) => ({ ...prev, [editingTicket.id]: tags }));

      // merge any new tags into allTags (so filters show them immediately)
      setAllTags((prev) => {
        const set = new Set(prev.map((t) => t.value));
        const merged = [...prev];
        tags.forEach((t) => {
          if (!set.has(t)) merged.push({ value: t, label: t });
        });
        return merged;
      });

      toast.success("Tags saved");
      setEditDialogOpen(false);
    } catch (e: any) {
      toast.error(e?.message || "Failed to save tags");
    } finally {
      setSavingTags(false);
    }
  };

  /* ------------------------ Columns (StandardDataTable) ------------------------ */
  const columnHelper = createColumnHelper<Ticket>();

  // NOTE: Use ColumnDef<Ticket, any>[] to avoid narrow TValue mismatch.
  const columns = useMemo<ColumnDef<Ticket, any>[]>(
    () => [
      columnHelper.accessor("ticketKey", {
        header: "Ticket #",
        cell: ({ getValue }) => getValue(),
      }),
      columnHelper.display({
        id: "title",
        header: "Title",
        cell: ({ row }) => {
          const t = row.original;
          const displayName = [t?.firstName, t?.lastName].filter(Boolean).join(" ").trim();
          const hasUsername = Boolean(t?.username && t.username.trim());
          const titleAttr =
            [displayName, hasUsername ? `@${t.username}` : ""]
              .filter(Boolean)
              .join(" ") || "Unknown user";

          return (
            <div className="flex flex-col">
              <span className="font-medium">{t.title}</span>
              <Link
                href={`/clients/${t.clientId}/info/`}
                className="text-xs text-muted-foreground hover:underline truncate"
                title={titleAttr}
              >
                {displayName && hasUsername && (
                  <>
                    <span className="font-normal">{displayName}</span>{" "}
                    <span className="text-muted-foreground">@{t.username}</span>
                  </>
                )}
                {displayName && !hasUsername && <span className="font-normal">{displayName}</span>}
                {!displayName && hasUsername && <span className="font-normal">@{t.username}</span>}
                {!displayName && !hasUsername && <span className="font-normal">Unknown user</span>}
              </Link>
            </div>
          );
        },
      }),
      columnHelper.display({
        id: "tags",
        header: "Tags",
        cell: ({ row }) => {
          const t = row.original;
          const tags = tagsMap[t.id] || [];

          if (tags.length === 0) {
            return (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => openTagsDialog({ id: t.id, title: t.title })}
                aria-label="Add tags"
                title="Add tags"
              >
                <Plus className="h-4 w-4" />
              </Button>
            );
          }

          // Click anywhere on the badge group to edit
          return (
            <button
              type="button"
              className="group inline-flex flex-wrap items-center gap-1 hover:opacity-90"
              onClick={() => openTagsDialog({ id: t.id, title: t.title })}
              title="Edit tags"
              aria-label="Edit tags"
            >
              {tags.map((desc) => (
                <Badge key={desc} variant="outline" className="mr-0">
                  {desc}
                </Badge>
              ))}
              <Tags className="ml-1 h-3.5 w-3.5 text-muted-foreground opacity-70 group-hover:opacity-100" />
            </button>
          );
        },
      }),
      columnHelper.accessor("priority", {
        header: "Priority",
        cell: ({ getValue }) => {
          const p = getValue() as Ticket["priority"];
          const cls =
            {
              low: "bg-green-100 text-green-800",
              medium: "bg-yellow-100 text-yellow-800",
              high: "bg-red-100 text-red-800",
            }[p] || "";
          return (
            <Badge variant="outline" className={cls}>
              {p.charAt(0).toUpperCase() + p.slice(1)}
            </Badge>
          );
        },
      }),
      columnHelper.accessor("status", {
        header: "Status",
        cell: ({ getValue }) => {
          const s = getValue() as Ticket["status"];
          const cls =
            {
              open: "bg-blue-100 text-blue-800",
              "in-progress": "bg-purple-100 text-purple-800",
              closed: "bg-gray-100 text-gray-800",
            }[s] || "";
          return (
            <Badge variant="outline" className={cls}>
              {s === "in-progress" ? "In Progress" : s.charAt(0).toUpperCase() + s.slice(1)}
            </Badge>
          );
        },
      }),
      columnHelper.accessor("createdAt", {
        header: "Created",
        cell: ({ getValue }) =>
          new Date(getValue() as string).toLocaleString("en-US", {
            dateStyle: "medium",
            timeStyle: "short",
          }),
      }),
      columnHelper.display({
        id: "actions",
        header: () => <div className="text-right">Actions</div>,
        cell: ({ row }) => {
          const t = row.original;
          return (
            <div className="text-right">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-8 w-8">
                    <MoreVertical className="h-4 w-4" />
                    <span className="sr-only">Open actions</span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-44">
                  <DropdownMenuItem asChild>
                    <Link href={`/tickets/${t.id}`} className="flex items-center gap-2">
                      <Eye className="h-4 w-4" />
                      View
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    disabled={t.status !== "closed"}
                    onClick={() => t.status === "closed" && reopenTicket(t.id)}
                    className="flex items-center gap-2"
                  >
                    <RotateCcw className="h-4 w-4" />
                    Reopen
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          );
        },
      }),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tagsMap],
  );

  /* ------------------------ Table instance ------------------------ */
  const table = useReactTable({
    data: filtered,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  /* ------------------------ UI ------------------------ */
  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row justify-between items-center gap-4">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setCurrentPage(1);
            fetchTickets();
          }}
          className="flex w-full sm:w-auto gap-2"
        >
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              type="search"
              placeholder="Search tickets..."
              className="pl-8"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <Button type="submit">Search</Button>
        </form>

        <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
          <div className="w-full sm:w-60">
            <ReactSelect
              isMulti
              options={allTags}
              value={selectedTags}
              onChange={(v) => setSelectedTags(v as any)}
              placeholder="Filter by tags…"
            />
          </div>

          {/* ✅ Coerce string to union for priority */}
          <Select
            value={priorityFilter}
            onValueChange={(v) =>
              setPriorityFilter(v as "all" | "low" | "medium" | "high")
            }
            className="w-[120px]"
          >
            <SelectTrigger>
              <SelectValue placeholder="Any Priority" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All priorities</SelectItem>
              <SelectItem value="low">Low</SelectItem>
              <SelectItem value="medium">Medium</SelectItem>
              <SelectItem value="high">High</SelectItem>
            </SelectContent>
          </Select>

          {/* ✅ Coerce string to union for status */}
          <Select
            value={statusFilter}
            onValueChange={(v) =>
              setStatusFilter(v as "all" | "open" | "in-progress" | "closed")
            }
            className="w-[140px]"
          >
            <SelectTrigger>
              <SelectValue placeholder="Any Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="open">Open</SelectItem>
              <SelectItem value="in-progress">In Progress</SelectItem>
              <SelectItem value="closed">Closed</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Standard data table */}
      <StandardDataTable
        table={table}
        columns={columns}
        isLoading={loading}
        skeletonRows={6}
        emptyMessage="No tickets match your filters."
        className="rounded-md border"
      />

      {/* Pagination */}
      <div className="flex items-center justify-between">
        <div className="text-sm text-muted-foreground">
          Page {currentPage} of {totalPages}
        </div>
        <div className="flex items-center space-x-2">
          <div className="flex-row sm:flex-col">
            <p className="text-sm font-medium">Rows per page</p>
            <Select
              value={pageSize.toString()}
              onValueChange={(v) => {
                setPageSize(Number(v));
                setCurrentPage(1);
              }}
            >
              <SelectTrigger className="h-8 w-[70px]">
                <SelectValue placeholder={pageSize} />
              </SelectTrigger>
              <SelectContent side="top">
                {[5, 10, 20, 50, 100].map((n) => (
                  <SelectItem key={n} value={n.toString()}>
                    {n}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button
            variant="outline"
            size="icon"
            onClick={() => setCurrentPage(1)}
            disabled={currentPage === 1}
          >
            <ChevronsLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            onClick={() => setCurrentPage((p) => p - 1)}
            disabled={currentPage === 1}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            onClick={() => setCurrentPage((p) => p + 1)}
            disabled={currentPage === totalPages}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            onClick={() => setCurrentPage(totalPages)}
            disabled={currentPage === totalPages}
          >
            <ChevronsRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* ───────────────────────── Edit Tags Dialog ───────────────────────── */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editingTicket ? `Edit tags — ${editingTicket.title}` : "Edit tags"}
            </DialogTitle>
          </DialogHeader>

          <CreatableSelect
            isMulti
            options={allTags}
            value={editTags}
            onChange={(v) => setEditTags(v as any)}
            placeholder="Select or type tags…"
            formatCreateLabel={(input) => `Add "${input}"`}
            menuPlacement="auto"
          />

          <DialogFooter className="mt-4">
            <DialogClose asChild>
              <Button variant="ghost" type="button" disabled={savingTags}>
                Cancel
              </Button>
            </DialogClose>
            <Button
              type="button"
              onClick={saveTagsForTicket}
              disabled={savingTags || !editingTicket}
            >
              {savingTags ? "Saving…" : "Save tags"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
