"use client";

import React, { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
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
import Image from "next/image";
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

// Define the Coupon type.
type Coupon = {
  id: string;
  name: string;
  code: string;
  description: string;
  expirationDate: string;
  limitPerUser: string;
  usageLimit: number;
  expendingLimit: number;
  countries: string[]; // Array of country names or codes.
  visibility: boolean; // true means visible, false means hidden.
};

export function CouponsTable() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // State for coupon data and UI behavior.
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [loading, setLoading] = useState(true);
  const [totalPages, setTotalPages] = useState(1);
  const [currentPage, setCurrentPage] = useState(1);
  const [searchQuery, setSearchQuery] = useState("");
  const [pageSize, setPageSize] = useState(10);

  // Fetch coupons from the API endpoint.
  const fetchCoupons = async () => {
    setLoading(true);
    try {
      const response = await fetch(
        `/api/coupons?page=${currentPage}&pageSize=${pageSize}&search=${searchQuery}`
      );

      if (!response.ok) {
        throw new Error("Failed to fetch coupons");
      }

      const data = await response.json();

      // Ensure the countries field is always an array.
      const safeCoupons = data.coupons.map((coupon: Coupon) => ({
        ...coupon,
        countries: coupon.countries ?? [],
      }));

      setCoupons(safeCoupons);
      setTotalPages(data.totalPages);
      setCurrentPage(data.currentPage);
    } catch (error) {
      console.error("Error fetching coupons:", error);
      toast.error("Failed to load coupons");
    } finally {
      setLoading(false);
    }
  };

  // Fetch coupons on initial load and when dependencies change.
  useEffect(() => {
    fetchCoupons();
  }, [currentPage, pageSize, searchQuery]);

  // Handle search form submission.
  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setCurrentPage(1);
    fetchCoupons();
  };

  // Sorting state and function.
  const [sortColumn, setSortColumn] = useState<string>("name");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");

  const handleSort = (column: string) => {
    if (sortColumn === column) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc");
    } else {
      setSortColumn(column);
      setSortDirection("asc");
    }
  };

  // Sort coupons based on sortColumn and sortDirection.
  const sortedCoupons = [...coupons].sort((a, b) => {
    if (sortColumn === "name") {
      return sortDirection === "asc"
        ? a.name.localeCompare(b.name)
        : b.name.localeCompare(a.name);
    } else if (sortColumn === "usageLimit") {
      return sortDirection === "asc"
        ? a.usageLimit - b.usageLimit
        : b.usageLimit - a.usageLimit;
    }
    return 0;
  });

  // Handle coupon deletion.
  const handleDelete = async (id: string) => {
    if (!confirm("Are you sure you want to delete this coupon?")) {
      return;
    }

    try {
      const response = await fetch(`/api/coupons/${id}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        throw new Error("Failed to delete coupon");
      }

      toast.success("Coupon deleted successfully");
      fetchCoupons();
    } catch (error) {
      console.error("Error deleting coupon:", error);
      toast.error("Failed to delete coupon");
    }
  };

  // Navigation actions for editing and creating coupons.
  const handleEdit = (coupon: Coupon) => {
    router.push(`/coupons/${coupon.id}`);
  };

  const handleAdd = () => {
    router.push(`/coupons/new`);
  };

  return (
    <div className="space-y-4">
      {/* Header: Search & Add Coupon */}
      <div className="flex flex-col sm:flex-row justify-between gap-4">
        <form onSubmit={handleSearch} className="flex w-full sm:w-auto gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              type="search"
              placeholder="Search coupons..."
              className="pl-8 w-full"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          <Button type="submit">Search</Button>
        </form>
        <Button onClick={handleAdd}>
          <Plus className="mr-2 h-4 w-4" />
          Add Coupon
        </Button>
      </div>

      {/* Coupons Table */}
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Code</TableHead>
              <TableHead>Description</TableHead>
              <TableHead>Expiration Date</TableHead>
              <TableHead>Limit Per User</TableHead>
              <TableHead
                className="cursor-pointer"
                onClick={() => handleSort("usageLimit")}
              >
                Usage Limit {sortColumn === "usageLimit" && (sortDirection === "asc" ? "↑" : "↓")}
              </TableHead>
              <TableHead>Expending Limit</TableHead>
              <TableHead>Countries</TableHead>
              <TableHead>Visibility</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={8} className="h-24 text-center">
                  Loading...
                </TableCell>
              </TableRow>
            ) : sortedCoupons.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="h-24 text-center">
                  No coupons found.
                </TableCell>
              </TableRow>
            ) : (
              sortedCoupons.map((coupon) => (
                <TableRow key={coupon.id}>
                  <TableCell>{coupon.name}</TableCell>
                  <TableCell>{coupon.code}</TableCell>
                  <TableCell>{coupon.description}</TableCell>
                  <TableCell>{coupon.expirationDate}</TableCell>
                  <TableCell>{coupon.limitPerUser}</TableCell>
                  <TableCell>{coupon.usageLimit}</TableCell>
                  <TableCell>{coupon.expendingLimit}</TableCell>
                  <TableCell>
                    {coupon.countries.map((count) => (
                      <Badge
                      key={count}
                      variant="outline"
                      className="mr-1"
                    >
                      {count}
                    </Badge>
                    ))}
                  </TableCell>
                  <TableCell>{coupon.visibility ? "Visible" : "Hidden"}</TableCell>
                  <TableCell className="text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon">
                          <MoreVertical className="h-4 w-4" />
                          <span className="sr-only">Open menu</span>
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => handleEdit(coupon)}>
                          <Edit className="mr-2 h-4 w-4" />
                          Edit
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handleDelete(coupon.id)}
                          className="text-destructive focus:text-destructive"
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

      {/* Pagination Controls */}
      <div className="flex items-center justify-between">
        <div className="text-sm text-muted-foreground">
          Showing page {currentPage} of {totalPages}
        </div>
        <div className="flex items-center space-x-2">
          <div className="flex items-center space-x-2">
            <p className="text-sm font-medium">Rows per page</p>
            <Select
              value={pageSize.toString()}
              onValueChange={(value) => {
                setPageSize(Number(value));
                setCurrentPage(1);
              }}
            >
              <SelectTrigger className="h-8 w-[70px]">
                <SelectValue placeholder={pageSize} />
              </SelectTrigger>
              <SelectContent side="top">
                {[5, 10, 20, 50, 100].map((size) => (
                  <SelectItem key={size} value={size.toString()}>
                    {size}
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
              <span className="sr-only">First page</span>
            </Button>
            <Button
              variant="outline"
              size="icon"
              onClick={() => setCurrentPage(currentPage - 1)}
              disabled={currentPage === 1}
            >
              <ChevronLeft className="h-4 w-4" />
              <span className="sr-only">Previous page</span>
            </Button>
            <Button
              variant="outline"
              size="icon"
              onClick={() => setCurrentPage(currentPage + 1)}
              disabled={currentPage === totalPages}
            >
              <ChevronRight className="h-4 w-4" />
              <span className="sr-only">Next page</span>
            </Button>
            <Button
              variant="outline"
              size="icon"
              onClick={() => setCurrentPage(totalPages)}
              disabled={currentPage === totalPages}
            >
              <ChevronsRight className="h-4 w-4" />
              <span className="sr-only">Last page</span>
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
