// File: src/app/(dashboard)/reviews/reviews-table.tsx
"use client";

import React, {
  useState,
  useEffect,
  startTransition,
  type FormEvent,
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Search,
  ThumbsUp,
  Minus,
  ThumbsDown,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
} from "lucide-react";

import { useDebounce } from "@/hooks/use-debounce";         // ← NEW
import { Button }       from "@/components/ui/button";
import { Input }        from "@/components/ui/input";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { useHasPermission } from "@/hooks/use-has-permission";
import { authClient } from "@/lib/auth-client";


/* ------------------------------------------------------------------ */
/*  Types                                                             */
/* ------------------------------------------------------------------ */
type Review = {
  id: string;
  orderId: string;
  text: string;
  rate: "positive" | "neutral" | "negative";
  createdAt: string;
};

/* ------------------------------------------------------------------ */
/*  Component                                                         */
/* ------------------------------------------------------------------ */
export function ReviewsTable() {
  const router = useRouter();

     // permission to deep-link into orders
   const { data: activeOrg } = authClient.useActiveOrganization();
   const organizationId = activeOrg?.id ?? null;
   const {
     hasPermission: canViewOrders,
   } = useHasPermission(organizationId, { order: ["view"] });

  /* ── state ─────────────────────────────────────────────────────── */
  const [reviews,      setReviews     ] = useState<Review[]>([]);
  const [loading,      setLoading     ] = useState(true);
  const [totalPages,   setTotalPages  ] = useState(1);
  const [currentPage,  setCurrentPage ] = useState(1);
  const [pageSize,     setPageSize    ] = useState(10);

  const [searchQuery,  setSearchQuery ] = useState("");
  const debounced                       = useDebounce(searchQuery, 300); // ← NEW

  /* modal */
  const [modalOpen, setModalOpen] = useState(false);
  const [modalText, setModalText] = useState("");

  /* ---------------------------------------------------------------- */
  /*  Helpers                                                         */
  /* ---------------------------------------------------------------- */
  const rateIcon = (rate: Review["rate"]) =>
    rate === "positive" ? (
      <ThumbsUp className="h-5 w-5 text-green-600" />
    ) : rate === "neutral" ? (
      <Minus className="h-5 w-5 text-gray-600" />
    ) : (
      <ThumbsDown className="h-5 w-5 text-red-600" />
    );

  /* ---------------------------------------------------------------- */
  /*  Fetch                                                           */
  /* ---------------------------------------------------------------- */
  const fetchReviews = async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams({
        page: String(currentPage),
        pageSize: String(pageSize),
        search: debounced,
      });
      const res = await fetch(`/api/reviews?${qs.toString()}`);
      if (!res.ok) throw new Error("Failed to load reviews");
      const data = await res.json();
      setReviews(data.reviews);
      setTotalPages(data.totalPages);
      setCurrentPage(data.currentPage);
    } catch (err: any) {
      console.error(err);
      toast.error(err.message || "Error fetching reviews");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchReviews();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPage, pageSize, debounced]);

  /* ---------------------------------------------------------------- */
  /*  JSX                                                             */
  /* ---------------------------------------------------------------- */
  return (
    <div className="space-y-4">
      {/* Search */}
      <div className="flex flex-col sm:flex-row justify-between gap-4">
        <form
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            setCurrentPage(1); // effect will fetch with debounced query
          }}
          className="flex w-full sm:w-auto gap-2"
        >
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              type="search"
              placeholder="Search reviews…"
              className="pl-8 w-full"
              value={searchQuery}
              onChange={(e) =>
                startTransition(() => {
                  setSearchQuery(e.target.value);
                  setCurrentPage(1);
                })
              }
            />
          </div>
          <Button type="submit">Search</Button>
        </form>
      </div>

      {/* Table */}
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Order</TableHead>
              <TableHead>Text</TableHead>
              <TableHead>Rate</TableHead>
              <TableHead>Created</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={4} className="h-24 text-center">
                  Loading…
                </TableCell>
              </TableRow>
            ) : reviews.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="h-24 text-center">
                  No reviews found.
                </TableCell>
              </TableRow>
            ) : (
              reviews.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>
                               {canViewOrders ? (
              <Link
                href={`/orders/${r.orderId}`}
                className="text-blue-600 hover:underline"
              >
                {r.orderId}
              </Link>
            ) : (
              <span className="text-muted-foreground" title="No permission to view orders">
                {r.orderId}
              </span>
            )}

                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => {
                        setModalText(r.text);
                        setModalOpen(true);
                      }}
                    >
                      <Search className="h-5 w-5" />
                    </Button>
                  </TableCell>
                  <TableCell>{rateIcon(r.rate)}</TableCell>
                  <TableCell>
                    {new Date(r.createdAt).toLocaleString(undefined, {
                      dateStyle: "medium",
                      timeStyle: "short",
                    })}
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
          Page {currentPage} of {totalPages}
        </div>
        <div className="flex items-center space-x-2">
          <div className="flex-row sm:flex-col">
            <p className="text-sm font-medium">Rows per page</p>
            <Select
              value={pageSize.toString()}
              onValueChange={(v) =>
                startTransition(() => {
                  setPageSize(Number(v));
                  setCurrentPage(1);
                })
              }
            >
              <SelectTrigger className="h-8 w-[70px]">
                <SelectValue />
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

      {/* Modal */}
      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Review Text</DialogTitle>
          </DialogHeader>
          <DialogDescription className="whitespace-pre-wrap">
            {modalText}
          </DialogDescription>
          <DialogFooter>
            <DialogClose asChild>
              <Button>Close</Button>
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
