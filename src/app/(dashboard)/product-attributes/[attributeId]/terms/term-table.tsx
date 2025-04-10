"use client";

import { useState, useEffect } from "react";
import {
  MoreVertical,
  Plus,
  Search,
  Trash2,
  Edit,
} from "lucide-react";
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
import { toast } from "sonner";
import { TermDrawer } from "./term-drawer";

type Term = {
  id: string;
  name: string;
  slug: string;
};

export function TermTable({ attributeId }: { attributeId: string }) {
  const [terms, setTerms] = useState<Term[]>([]);
  const [loading, setLoading] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingTerm, setEditingTerm] = useState<Term | null>(null);

  const fetchTerms = async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/product-attributes/${attributeId}/terms?pageSize=100`, {
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to fetch terms");
      const data = await response.json();
      setTerms(data.terms);
    } catch (error) {
      console.error("Error fetching terms:", error);
      toast.error("Failed to load terms");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTerms();
  }, [attributeId]);

  const handleDelete = async (id: string) => {
    if (!confirm("Are you sure you want to delete this term?")) return;

    try {
      const response = await fetch(`/api/product-attributes/${attributeId}/terms/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to delete term");
      toast.success("Term deleted successfully");
      fetchTerms();
    } catch (error) {
      console.error("Error deleting term:", error);
      toast.error("Failed to delete term");
    }
  };

  const handleEdit = (term: Term) => {
    setEditingTerm(term);
    setDrawerOpen(true);
  };

  const handleAdd = () => {
    setEditingTerm(null);
    setDrawerOpen(true);
  };

  const handleDrawerClose = (refreshData = false) => {
    setDrawerOpen(false);
    setEditingTerm(null);
    if (refreshData) fetchTerms();
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between gap-4">
        <form className="flex w-full sm:w-auto gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input type="search" placeholder="Search terms..." className="pl-8 w-full" />
          </div>
          <Button type="submit">Search</Button>
        </form>
        <Button onClick={handleAdd}>
          <Plus className="mr-2 h-4 w-4" />
          Add Term
        </Button>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Slug</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={3} className="h-24 text-center">Loading...</TableCell>
              </TableRow>
            ) : terms.length === 0 ? (
              <TableRow>
                <TableCell colSpan={3} className="h-24 text-center">No terms found.</TableCell>
              </TableRow>
            ) : (
              terms.map((term) => (
                <TableRow key={term.id}>
                  <TableCell className="font-medium">{term.name}</TableCell>
                  <TableCell>{term.slug}</TableCell>
                  <TableCell className="text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon">
                          <MoreVertical className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => handleEdit(term)}>
                          <Edit className="mr-2 h-4 w-4" />
                          Edit
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => handleDelete(term.id)}
                          className="text-destructive"
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

      <TermDrawer
        open={drawerOpen}
        onClose={handleDrawerClose}
        term={editingTerm}
        attributeId={attributeId}
      />
    </div>
  );
}