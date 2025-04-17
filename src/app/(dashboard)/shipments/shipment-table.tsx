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
  Search,
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
import Swal from "sweetalert2";

type CostGroup = {
  minOrderCost: number;
  maxOrderCost: number;
  shipmentCost: number;
};

type Shipment = {
  id: string;
  title: string;
  description: string;
  countries: string[];
  costs: string[];
  createdAt: string;
  updatedAt: string;
};

export function ShipmentsTable() {
  const router = useRouter();

  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [loading, setLoading] = useState(true);
  const [totalPages, setTotalPages] = useState(1);
  const [currentPage, setCurrentPage] = useState(1);
  const [searchQuery, setSearchQuery] = useState("");
  const [pageSize, setPageSize] = useState(10);

  // sorting
  const [sortColumn, setSortColumn] = useState<"title">("title");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");

  const fetchShipments = async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/shipments?page=${currentPage}&pageSize=${pageSize}&search=${encodeURIComponent(
          searchQuery
        )}`
      );
      if (!res.ok) throw new Error("Failed to fetch shipments");
      const json = await res.json();
      setShipments(json.shipments);
      setTotalPages(json.totalPages);
      setCurrentPage(json.currentPage);
    } catch (err) {
      console.error(err);
      toast.error("Failed to load shipments");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchShipments();
  }, [currentPage, pageSize, searchQuery]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setCurrentPage(1);
    fetchShipments();
  };

  const handleSort = (column: "title") => {
    if (sortColumn === column) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc");
    } else {
      setSortColumn(column);
      setSortDirection("asc");
    }
  };

  // only sorting by title for now
  const sorted = [...shipments].sort((a, b) => {
    if (sortColumn === "title") {
      return sortDirection === "asc"
        ? a.title.localeCompare(b.title)
        : b.title.localeCompare(a.title);
    }
    return 0;
  });

  const handleDelete = async (id: string) => {
    const { isConfirmed } = await Swal.fire({
      title: "Delete this shipment?",
      text: "This action cannot be undone.",
      icon: "warning",
      showCancelButton: true,
      confirmButtonText: "Yes, delete",
    });
    if (!isConfirmed) return;
    try {
      const res = await fetch(`/api/shipments/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Delete failed");
      toast.success("Shipment deleted");
      fetchShipments();
    } catch {
      toast.error("Failed to delete");
    }
  };

  return (
    <div className="space-y-4">
      {/* header */}
      <div className="flex flex-col sm:flex-row justify-between gap-4">
        <form onSubmit={handleSearch} className="flex w-full sm:w-auto gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-2 top-2 h-4 w-4 text-muted-foreground" />
            <Input
              type="search"
              placeholder="Search shipments..."
              className="pl-8 w-full"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          <Button type="submit">Search</Button>
        </form>
        <Button onClick={() => router.push("/shipments/new")}>
          <Plus className="mr-2 h-4 w-4" />
          Add Shipment
        </Button>
      </div>

      {/* table */}
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead
                className="cursor-pointer"
                onClick={() => handleSort("title")}
              >
                Title{" "}
                {sortColumn === "title" &&
                  (sortDirection === "asc" ? "↑" : "↓")}
              </TableHead>
              <TableHead>Description</TableHead>
              <TableHead>Countries</TableHead>
              <TableHead>Costs</TableHead>
              <TableHead>Created At</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={6} className="h-24 text-center">
                  Loading...
                </TableCell>
              </TableRow>
            ) : sorted.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="h-24 text-center">
                  No shipments found.
                </TableCell>
              </TableRow>
            ) : (
              sorted.map((s) => (
                <TableRow key={s.id}>
                  <TableCell>{s.title}</TableCell>
                  <TableCell className="truncate max-w-xs">
                    {s.description}
                  </TableCell>
                  <TableCell>
                    {s.countries.map((c) => (
                      <Badge
                        key={c}
                        variant="outline"
                        className="mr-1 mb-1 inline-block"
                      >
                        {c}
                      </Badge>
                    ))}
                  </TableCell>
                  <TableCell>
                    {s.costs.map((g, i) => (
                      <div key={i} className="text-sm mb-1">
                        {g.minOrderCost.toFixed(2)}–{g.maxOrderCost.toFixed(2)}{" "}
                        = {g.shipmentCost.toFixed(2)}
                      </div>
                    ))}
                  </TableCell>
                  <TableCell>
                    {new Date(s.createdAt).toLocaleDateString()}
                  </TableCell>
                  <TableCell className="text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon">
                          <MoreVertical className="h-4 w-4" />
                          <span className="sr-only">Open menu</span>
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onClick={() => router.push(`/shipments/${s.id}`)}
                        >
                          <Edit className="mr-2 h-4 w-4" />
                          Edit
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          className="text-destructive focus:text-destructive"
                          onClick={() => handleDelete(s.id)}
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

      {/* pagination */}
      <div className="flex items-center justify-between">
        <div className="text-sm text-muted-foreground">
          Page {currentPage} of {totalPages}
        </div>
        <div className="flex items-center space-x-2">
          <div className="flex items-center space-x-2">
            <p className="text-sm font-medium">Rows per page</p>
            <Select
              value={pageSize.toString()}
              onValueChange={(v) => {
                setPageSize(Number(v));
                setCurrentPage(1);
              }}
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
    </div>
  );
}
