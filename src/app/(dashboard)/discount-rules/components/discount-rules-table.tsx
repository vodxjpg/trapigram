// src/app/(dashboard)/discount-rules/components/discount-rules-table.tsx
"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  MoreVertical,
  Plus,
  Trash2,
  Edit,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { toast } from "sonner";
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

type Step = { fromUnits: number; toUnits: number; price: number };
type ProdItem = { productId: string | null; variationId: string | null };

type TierPricing = {
  id: string;
  name: string;
  countries: string[];
  steps: Step[];
  products: ProdItem[];
};

export function DiscountRulesTable() {
  const router = useRouter();
  const [rules, setRules] = useState<TierPricing[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [pageSize, setPageSize] = useState(10);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [ruleToDelete, setRuleToDelete] = useState<TierPricing | null>(null);

  const fetchRules = async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/tier-pricing?page=${page}&pageSize=${pageSize}&search=${search}`,
      );
      if (!res.ok) throw new Error("Failed to fetch");
      const { tierPricings } = await res.json();   // ← correct key
      setRules(tierPricings);
      setTotalPages(1); // TODO: update once backend pagination added
    } catch {
      toast.error("Failed to load tier-pricing rules");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRules();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, pageSize, search]);

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

  return (
    <div className="space-y-4">
      {/* search & add */}
      <div className="flex flex-col gap-4 sm:flex-row sm:justify-between">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setPage(1);
            fetchRules();
          }}
          className="flex w-full gap-2 sm:w-auto"
        >
          <Input
            type="search"
            placeholder="Search rules..."
            className="w-full pl-8"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <Button type="submit">Search</Button>
        </form>
        <Button onClick={() => router.push("/discount-rules/new")}>
          <Plus className="mr-2 h-4 w-4" />
          Add Rule
        </Button>
      </div>

      {/* table */}
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Countries</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={3} className="h-24 text-center">
                  Loading…
                </TableCell>
              </TableRow>
            ) : rules.length === 0 ? (
              <TableRow>
                <TableCell colSpan={3} className="h-24 text-center">
                  No tier-pricing rules.
                </TableCell>
              </TableRow>
            ) : (
              rules.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>{r.name}</TableCell>
                  <TableCell>
                    {r.countries.map((c) => (
                      <Badge key={c} variant="outline" className="mr-1">
                        {c}
                      </Badge>
                    ))}
                  </TableCell>
                  <TableCell className="text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon">
                          <MoreVertical className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onClick={() => router.push(`/discount-rules/${r.id}`)}
                        >
                          <Edit className="mr-2 h-4 w-4" />
                          Edit
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          className="text-destructive"
                          onClick={() => setRuleToDelete(r)}
                        >
                          <Trash2 className="mr-2 h-4 w-4" />
                          Delete
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
          Page {page} of {totalPages}
        </div>
        <div className="flex items-center space-x-2">
          <p className="text-sm font-medium">Rows:</p>
          <Select
            value={pageSize.toString()}
            onValueChange={(v) => {
              setPageSize(Number(v));
              setPage(1);
            }}
          >
            <SelectTrigger className="h-8 w-[70px]">
              <SelectValue placeholder={pageSize} />
            </SelectTrigger>
            <SelectContent side="top">
              {[5, 10, 20, 50].map((n) => (
                <SelectItem key={n} value={n.toString()}>
                  {n}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" size="icon" disabled={page === 1} onClick={() => setPage(1)}>
            <ChevronsLeft className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="icon" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>
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

      <AlertDialog
        open={!!ruleToDelete}
        onOpenChange={(o) => { if (!o) setRuleToDelete(null); }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Discount Rule?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete “{ruleToDelete?.name}”? This cannot be undone.
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
