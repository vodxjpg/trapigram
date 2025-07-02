// src/app/(dashboard)/product-attributes/attribute-table.tsx
"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
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
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { usePermission } from "@/hooks/use-permission";
import { AttributeDrawer } from "./attribute-drawer";

type Attribute = {
  id: string;
  name: string;
  slug: string;
  _count?: { terms: number };
};

export function AttributeTable() {
  const router = useRouter();
   const can = usePermission(); ;

  const [attributes, setAttributes] = useState<Attribute[]>([]);
  const [loading, setLoading] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingAttribute, setEditingAttribute] = useState<Attribute | null>(null);

  const canCreate = can({ productAttributes: ["create"] });
  const canUpdate = can({ productAttributes: ["update"] });
  const canDelete = can({ productAttributes: ["delete"] });

  useEffect(() => {
    if (!can.loading && !can({ productAttributes: ["view"] })) {
      // shouldn't get here since page blocks it, but just in case
      router.replace("/product-attributes");
    }
  }, [can, router]);

  useEffect(() => {
    if (can.loading) return;
    fetchAttributes();
  }, [can]);

  const fetchAttributes = async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/product-attributes?pageSize=100", { credentials: "include" });
      if (!response.ok) throw new Error("Failed to fetch attributes");
      const data = await response.json();
      setAttributes(data.attributes);
    } catch {
      toast.error("Failed to load attributes");
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Are you sure you want to delete this attribute and its terms?")) return;
    try {
      const response = await fetch(`/api/product-attributes/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!response.ok) throw new Error();
      toast.success("Attribute deleted successfully");
      fetchAttributes();
    } catch {
      toast.error("Failed to delete attribute");
    }
  };

  const handleEdit = (attribute: Attribute) => {
    setEditingAttribute(attribute);
    setDrawerOpen(true);
  };

  const handleAdd = () => {
    setEditingAttribute(null);
    setDrawerOpen(true);
  };

  const handleDrawerClose = (refresh = false) => {
    setDrawerOpen(false);
    setEditingAttribute(null);
    if (refresh) fetchAttributes();
  };

  if (can.loading) return null;

  return (
    <div className="space-y-4">
      <div className="flex justify-between gap-4">
        <form className="flex w-full sm:w-auto gap-2" onSubmit={(e) => e.preventDefault()}>
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input type="search" placeholder="Search attributes..." className="pl-8 w-full" />
          </div>
          <Button type="submit">Search</Button>
        </form>
        {canCreate && (
          <Button onClick={handleAdd}>
            <Plus className="mr-2 h-4 w-4" />
            Add Attribute
          </Button>
        )}
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Slug</TableHead>
              <TableHead>Terms</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={4} className="h-24 text-center">
                  Loading...
                </TableCell>
              </TableRow>
            ) : attributes.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="h-24 text-center">
                  No attributes found.
                </TableCell>
              </TableRow>
            ) : (
              attributes.map((attribute) => (
                <TableRow key={attribute.id}>
                  <TableCell
                    className="font-medium cursor-pointer"
                    onClick={() => router.push(`/product-attributes/${attribute.id}/terms`)}
                  >
                    {attribute.name}
                  </TableCell>
                  <TableCell>{attribute.slug}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{attribute._count?.terms ?? 0}</Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon">
                          <MoreVertical className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {canUpdate && (
                          <DropdownMenuItem onClick={() => handleEdit(attribute)}>
                            <Edit className="mr-2 h-4 w-4" />
                            Edit
                          </DropdownMenuItem>
                        )}
                        {canDelete && <DropdownMenuSeparator />}
                        {canDelete && (
                          <DropdownMenuItem
                            onClick={() => handleDelete(attribute.id)}
                            className="text-destructive"
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

      <AttributeDrawer
        open={drawerOpen}
        onClose={handleDrawerClose}
        attribute={editingAttribute}
      />
    </div>
  );
}
