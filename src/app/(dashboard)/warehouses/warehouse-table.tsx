// src/app/(dashboard)/warehouses/warehouse-table.tsx
"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  Plus,
  Search,
  MoreVertical,
  Edit,
  Trash2,
  Share2,
  RefreshCw,
} from "lucide-react";
import Link from "next/link";
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
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { WarehouseDrawer } from "./warehouse-drawer";
import { usePermission } from "@/hooks/use-permission";

type Warehouse = {
  id: string;
  tenantId: string | null;
  organizationId: string[];
  name: string;
  countries: string[];
  createdAt: Date;
  updatedAt: Date;
};

export function WarehouseTable() {
  const router = useRouter();
  const can = usePermission(organizationId);;

  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [loading, setLoading] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingWarehouse, setEditingWarehouse] = useState<Warehouse | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [syncToken, setSyncToken] = useState("");

  const canCreate = can({ warehouses: ["create"] });
  const canUpdate = can({ warehouses: ["update"] });
  const canDelete = can({ warehouses: ["delete"] });
  const canShare = can({ warehouses: ["sharing"] });
  const canSync     = can({ warehouses: ["synchronize"] });

  useEffect(() => {
    if (!can.loading && !can({ warehouses: ["view"] })) {
      router.replace("/warehouses");
    }
  }, [can, router]);

  useEffect(() => {
    if (can.loading) return;
    fetchWarehouses();
  }, [can]);

  const fetchWarehouses = async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/warehouses");
      if (!response.ok) throw new Error("Failed to fetch warehouses");
      const data = await response.json();
      setWarehouses(data.warehouses);
    } catch {
      toast.error("Failed to load warehouses");
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Are you sure you want to delete this warehouse?")) return;
    try {
      const response = await fetch(`/api/warehouses/${id}`, { method: "DELETE" });
      if (!response.ok) throw new Error();
      toast.success("Warehouse deleted successfully");
      fetchWarehouses();
    } catch {
      toast.error("Failed to delete warehouse");
    }
  };

  const handleEdit = (warehouse: Warehouse) => {
    setEditingWarehouse(warehouse);
    setDrawerOpen(true);
  };

  const handleAdd = () => {
    setEditingWarehouse(null);
    setDrawerOpen(true);
  };

  const handleDrawerClose = (refreshData = false) => {
    setDrawerOpen(false);
    setEditingWarehouse(null);
    if (refreshData) fetchWarehouses();
  };

  const handleSyncWarehouse = () => {
    let token = syncToken.trim();
    try {
      const parsed = new URL(token);
      const segments = parsed.pathname.split("/").filter(Boolean);
      if (segments.length) token = segments[segments.length - 1];
    } catch {
      // raw token
    }
    if (!token) {
      toast.error("Please enter a valid invitation code or link");
      return;
    }
    setDialogOpen(false);
    router.push(`/share/${token}`);
  };

  if (can.loading) return null;
  if (!can({ warehouses: ["view"] })) return null;

  return (
    <div className="space-y-4">
      <div className="flex justify-between gap-4">
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search warehouses..." className="pl-8" />
        </div>
        <div className="flex gap-2">
      {canSync && (
        <Button variant="outline" onClick={() => setDialogOpen(true)}>
          <RefreshCw className="mr-2 h-4 w-4" />
          Sync Warehouse
        </Button>
      )}
          {canCreate && (
            <Button onClick={handleAdd}>
              <Plus className="mr-2 h-4 w-4" />
              Add Warehouse
            </Button>
          )}
          {canShare && (
            <Button asChild>
              <Link href="/warehouses/share-links">
                <Share2 className="mr-2 h-4 w-4" />
                View Share Links
              </Link>
            </Button>
          )}
        </div>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Organizations</TableHead>
              <TableHead>Countries</TableHead>
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
            ) : warehouses.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="h-24 text-center">
                  No warehouses found.
                </TableCell>
              </TableRow>
            ) : (
              warehouses.map((warehouse) => (
                <TableRow key={warehouse.id}>
                  <TableCell className="font-medium">{warehouse.name}</TableCell>
                  <TableCell>
                    {warehouse.organizationId.map((id) => (
                      <Badge key={id} variant="outline" className="mr-1">
                        {id}
                      </Badge>
                    ))}
                  </TableCell>
                  <TableCell>
                    {warehouse.countries.map((ct) => (
                      <Badge key={ct} variant="outline" className="mr-1">
                        {ct}
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
                        {canUpdate && (
                          <DropdownMenuItem onClick={() => handleEdit(warehouse)}>
                            <Edit className="mr-2 h-4 w-4" />
                            Edit
                          </DropdownMenuItem>
                        )}
                        {canShare && (
                          <>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem>
                              <Link
                                href={`/warehouses/${warehouse.id}/share`}
                                className="flex items-center"
                              >
                                <Share2 className="mr-2 h-4 w-4" />
                                Share
                              </Link>
                            </DropdownMenuItem>
                          </>
                        )}
                        {canDelete && (
                          <>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              onClick={() => handleDelete(warehouse.id)}
                              className="text-destructive"
                            >
                              <Trash2 className="mr-2 h-4 w-4" />
                              Delete
                            </DropdownMenuItem>
                          </>
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

      <WarehouseDrawer
        open={drawerOpen}
        onClose={handleDrawerClose}
        warehouse={editingWarehouse}
      />

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Sync Warehouse</DialogTitle>
          </DialogHeader>
          <Input
            placeholder="Enter invitation code or full URL"
            value={syncToken}
            onChange={(e) => setSyncToken(e.target.value)}
          />
          <DialogFooter>
            <Button onClick={handleSyncWarehouse}>
              Sync Warehouse
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
