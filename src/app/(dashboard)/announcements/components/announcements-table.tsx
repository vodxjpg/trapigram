// src/app/(dashboard)/announcements/announcements-table.tsx
"use client";

import React, {
  useState,
  useEffect,
  startTransition,
  type FormEvent,
  useMemo,
} from "react";
import { useRouter } from "next/navigation";
import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  MoreVertical,
  Plus,
  Search,
  Trash2,
  Edit,
  ZoomIn,
  Send as SendIcon,
} from "lucide-react";

import { useDebounce } from "@/hooks/use-debounce";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { toast } from "sonner";
import "react-quill-new/dist/quill.snow.css";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
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

// ⬇️ TanStack + Standard table
import {
  useReactTable,
  getCoreRowModel,
  type ColumnDef,
} from "@tanstack/react-table";
import { StandardDataTable } from "@/components/data-table/data-table";

/* ------------------------------------------------------------------ */
/*  Types                                                             */
/* ------------------------------------------------------------------ */
type Announcement = {
  id: string;
  title: string;
  content: string;
  deliveryDate: string | null;
  status: string;
  sent: boolean;
  countries: string[];
};

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */
const fmtLocal = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    })
    : "—";

/* ------------------------------------------------------------------ */
/*  Component                                                         */
/* ------------------------------------------------------------------ */
export function AnnouncementsTable() {
  const router = useRouter();

  // table state
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);
  const [totalPages, setTotalPages] = useState(1);
  const [currentPage, setCurrentPage] = useState(1);
  const [searchQuery, setSearchQuery] = useState("");
  const debounced = useDebounce(searchQuery, 300);
  const [pageSize, setPageSize] = useState(10);

  // modal / dialog state
  const [contentModalOpen, setContentModalOpen] = useState(false);
  const [modalContent, setModalContent] = useState("");
  const [toDelete, setToDelete] = useState<Announcement | null>(null);
  const [toSend, setToSend] = useState<Announcement | null>(null);

  // sorting
  const [sortColumn, setSortColumn] = useState<string>("title");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");

  const handleSort = (column: string) => {
    if (sortColumn === column) {
      setSortDirection((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortColumn(column);
      setSortDirection("asc");
    }
  };

  const sortedAnnouncements = useMemo(() => {
    const list = [...announcements];
    if (sortColumn === "title") {
      list.sort((a, b) =>
        sortDirection === "asc"
          ? a.title.localeCompare(b.title)
          : b.title.localeCompare(a.title)
      );
    }
    return list;
  }, [announcements, sortColumn, sortDirection]);

  // fetch
  const fetchAnnouncements = async () => {
    setLoading(true);
    try {
      const response = await fetch(
        `/api/announcements?page=${currentPage}&pageSize=${pageSize}&search=${encodeURIComponent(
          debounced
        )}`,
        {
          headers: {
            "x-internal-secret":
              process.env.NEXT_PUBLIC_INTERNAL_API_SECRET || "",
          },
        }
      );
      if (!response.ok) throw new Error("Failed to fetch announcements");
      const data = await response.json();
      setAnnouncements(data.announcements);
      setTotalPages(data.totalPages);
      setCurrentPage(data.currentPage);
    } catch (err) {
      console.error(err);
      toast.error("Failed to load announcements");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAnnouncements();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPage, pageSize, debounced]);

  // actions
  const confirmDelete = async () => {
    if (!toDelete) return;
    try {
      const res = await fetch(`/api/announcements/${toDelete.id}`, {
        method: "DELETE",
        headers: {
          "x-internal-secret":
            process.env.NEXT_PUBLIC_INTERNAL_API_SECRET || "",
        },
      });
      if (!res.ok) throw new Error("Failed to delete announcement");
      toast.success("Announcement deleted successfully");
      fetchAnnouncements();
    } catch (error) {
      console.error(error);
      toast.error("Failed to delete announcement");
    } finally {
      setToDelete(null);
    }
  };

  const confirmSend = async () => {
    if (!toSend) return;
    try {
      const res = await fetch(`/api/announcements/send/${toSend.id}`, {
        method: "PATCH",
        headers: {
          "x-internal-secret":
            process.env.NEXT_PUBLIC_INTERNAL_API_SECRET || "",
        },
      });
      if (!res.ok) throw new Error("Failed to send announcement");
      toast.success("Announcement sent successfully");
      fetchAnnouncements();
    } catch (error: any) {
      console.error(error);
      toast.error(error.message || "Failed to send announcement");
    } finally {
      setToSend(null);
    }
  };

  // columns for StandardDataTable
  const columns = useMemo<ColumnDef<Announcement>[]>(
    () => [
      {
        accessorKey: "title",
        header: () => (
          <button
            type="button"
            onClick={() => handleSort("title")}
            className="cursor-pointer font-medium"
          >
            Title{" "}
            {sortColumn === "title" ? (sortDirection === "asc" ? "↑" : "↓") : ""}
          </button>
        ),
        cell: ({ row }) => <span>{row.original.title}</span>,
      },
      {
        id: "content",
        header: "Content",
        cell: ({ row }) => (
          <Button
            variant="ghost"
            size="icon"
            onClick={() => {
              setModalContent(row.original.content);
              setContentModalOpen(true);
            }}
          >
            <ZoomIn className="h-4 w-4" />
            <span className="sr-only">View Content</span>
          </Button>
        ),
      },
      {
        accessorKey: "deliveryDate",
        header: "Delivery Date",
        cell: ({ row }) => <span>{fmtLocal(row.original.deliveryDate)}</span>,
      },
      {
        accessorKey: "sent",
        header: "Sent",
        cell: ({ row }) =>
          row.original.sent ? (
            <Badge variant="default">Yes</Badge>
          ) : (
            <Badge variant="destructive">No</Badge>
          ),
      },
      {
        id: "countries",
        header: "Countries",
        cell: ({ row }) => (
          <div className="flex flex-wrap gap-1">
            {row.original.countries.map((c) => (
              <Badge key={c} variant="outline">
                {c}
              </Badge>
            ))}
          </div>
        ),
      },
      {
        id: "actions",
        header: () => <div className="text-right">Actions</div>,
        cell: ({ row }) => {
          const a = row.original;
          return (
            <div className="text-right">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon">
                    <MoreVertical className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => setToSend(a)}>
                    <SendIcon className="mr-2 h-4 w-4" />
                    Send
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => router.push(`/announcements/${a.id}`)}
                  >
                    <Edit className="mr-2 h-4 w-4" />
                    Edit
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className="text-destructive focus:text-destructive"
                    onClick={() => setToDelete(a)}
                  >
                    <Trash2 className="mr-2 h-4 w-4" />
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          );
        },
      },
    ],
    [router, sortColumn, sortDirection]
  );

  const table = useReactTable({
    data: sortedAnnouncements,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  /* ---------------------------------------------------------------- */
  /*  JSX                                                             */
  /* ---------------------------------------------------------------- */
  return (
    <div className="space-y-4">
      {/* Header / Search */}
      <div className="flex flex-col sm:flex-row justify-between gap-4">
        <form
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            setCurrentPage(1);
          }}
          className="flex w-full sm:w-auto gap-2"
        >
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              type="search"
              placeholder="Search announcements..."
              className="pl-8 w-full"
              value={searchQuery}
              onChange={(e) => {
                const txt = e.target.value;
                startTransition(() => {
                  setSearchQuery(txt);
                  setCurrentPage(1);
                });
              }}
            />
          </div>
          <Button type="submit">Search</Button>
        </form>
      </div>

      {/* Data table (standardized) */}
      <StandardDataTable
        table={table}
        columns={columns}
        isLoading={loading}
        skeletonRows={Math.min(pageSize, 10)}
        emptyMessage="No announcements found."
      />

      {/* Pagination */}
      <div className="flex items-center justify-between">
        <div className="text-sm text-muted-foreground">
          Showing page {currentPage} of {totalPages}
        </div>
        <div className="flex items-center space-x-2">
          <p className="text-sm font-medium">Rows / page</p>
          <Select
            value={pageSize.toString()}
            onValueChange={(v) => {
              startTransition(() => {
                setPageSize(Number(v));
                setCurrentPage(1);
              });
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
          <div className="flex items-center space-x-2">
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
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={currentPage === 1}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
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

      {/* Content dialog */}
      <Dialog open={contentModalOpen} onOpenChange={setContentModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Announcement Content</DialogTitle>
            <DialogDescription>
              Review the announcement HTML below.
            </DialogDescription>
          </DialogHeader>
          <div
            className="prose max-w-none"
            dangerouslySetInnerHTML={{ __html: modalContent }}
          />
          <DialogFooter>
            <DialogClose asChild>
              <Button>Close</Button>
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete dialog */}
      <AlertDialog open={!!toDelete} onOpenChange={(o) => !o && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Announcement?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete “{toDelete?.title}”? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Send dialog */}
      <AlertDialog open={!!toSend} onOpenChange={(o) => !o && setToSend(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Send Announcement?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to send “{toSend?.title}”? This will mark it as sent.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmSend}>Send</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
