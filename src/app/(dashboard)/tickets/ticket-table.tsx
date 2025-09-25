// src/app/(dashboard)/tickets/tickets-table.tsx
"use client";

import React, { useState, useEffect } from "react";
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
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
import { toast } from "sonner";
import ReactSelect from "react-select";

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
  }, [currentPage, pageSize, search]);

  const filtered = tickets.filter((t) => {
    if (priorityFilter !== "all" && t.priority !== priorityFilter) return false;
    if (statusFilter !== "all" && t.status !== statusFilter) return false;
    if (selectedTags.length) {
      const myTags = tagsMap[t.id] || [];
      if (!selectedTags.every((st) => myTags.includes(st.value))) return false;
    }
    return true;
  });

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

          <Select
            value={priorityFilter}
            onValueChange={setPriorityFilter}
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

          <Select
            value={statusFilter}
            onValueChange={setStatusFilter}
            className="w-[120px]"
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

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Ticket #</TableHead>
              <TableHead>Title</TableHead>
              <TableHead>Tags</TableHead>
              <TableHead>Priority</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Created</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={7} className="h-24 text-center">
                  Loading…
                </TableCell>
              </TableRow>
            ) : filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="h-24 text-center">
                  No tickets match your filters.
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((t) => (
                <TableRow key={t.id}>
                  <TableCell>{t.ticketKey}</TableCell>
                  <TableCell>{t.title}</TableCell>
                  <TableCell>
                  <div className="flex flex-col">
                    <span className="font-medium">{t.title}</span>
                    {/* customer line (like the details page) */}
                    <Link
                      href={`/clients/${t.clientId}/info/`}
                      className="text-xs text-muted-foreground hover:underline truncate"
                      title={
                        [
                          [t?.firstName, t?.lastName].filter(Boolean).join(" ").trim(),
                          t?.username ? `@${t.username}` : ""
                        ]
                          .filter(Boolean)
                          .join(" ")
                          || "Unknown user"
                      }
                    >
                      {(() => {
                        const displayName = [t?.firstName, t?.lastName].filter(Boolean).join(" ").trim();
                        const hasUsername = Boolean(t?.username && t.username.trim());
                        if (displayName && hasUsername) {
                          return (
                            <>
                              <span className="font-normal">{displayName}</span>{" "}
                              <span className="text-muted-foreground">@{t.username}</span>
                            </>
                          );
                        }
                        if (displayName) return <span className="font-normal">{displayName}</span>;
                        if (hasUsername) return <span className="font-normal">@{t.username}</span>;
                        return <span className="font-normal">Unknown user</span>;
                      })()}
                    </Link>
                  </div>
                </TableCell>
                  <TableCell>
                    {(tagsMap[t.id] || []).map((desc) => (
                      <Badge key={desc} variant="outline" className="mr-1">
                        {desc}
                      </Badge>
                    ))}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className={
                        {
                          low: "bg-green-100 text-green-800",
                          medium: "bg-yellow-100 text-yellow-800",
                          high: "bg-red-100 text-red-800",
                        }[t.priority]
                      }
                    >
                      {t.priority.charAt(0).toUpperCase() + t.priority.slice(1)}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className={
                        {
                          open: "bg-blue-100 text-blue-800",
                          "in-progress": "bg-purple-100 text-purple-800",
                          closed: "bg-gray-100 text-gray-800",
                        }[t.status]
                      }
                    >
                      {t.status === "in-progress"
                        ? "In Progress"
                        : t.status.charAt(0).toUpperCase() + t.status.slice(1)}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {new Date(t.createdAt).toLocaleString("en-US", {
                      dateStyle: "medium",
                      timeStyle: "short",
                    })}
                  </TableCell>
                  <TableCell className="text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-8 w-8">
                          <MoreVertical className="h-4 w-4" />
                          <span className="sr-only">Open actions</span>
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-44">
                        <DropdownMenuItem asChild>
                          <Link
                            href={`/tickets/${t.id}`}
                            className="flex items-center gap-2"
                          >
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
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

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
    </div>
  );
}
