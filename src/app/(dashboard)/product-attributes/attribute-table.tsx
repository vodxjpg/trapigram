// src/app/(dashboard)/product-attributes/attribute-table.tsx
"use client";

import { useState, useEffect }              from "react";
import { useRouter }                        from "next/navigation";
import useSWR                               from "swr";

import {
  Plus, MoreVertical, Search, Edit, Trash2,
}                                           from "lucide-react";

import { authClient }                       from "@/lib/auth-client";
import { useHasPermission }                 from "@/hooks/use-has-permission";

import { Button }                           from "@/components/ui/button";
import { Input }                            from "@/components/ui/input";
import {
  Table, TableBody, TableCell, TableHead,
  TableHeader, TableRow,
}                                           from "@/components/ui/table";
import {
  DropdownMenu, DropdownMenuContent,
  DropdownMenuItem, DropdownMenuSeparator,
  DropdownMenuTrigger,
}                                           from "@/components/ui/dropdown-menu";
import { Badge }                            from "@/components/ui/badge";
import { toast }                            from "sonner";

import { AttributeDrawer }                  from "./attribute-drawer";

/* ------------------------------------------------------------------ */
/*  Types                                                             */
/* ------------------------------------------------------------------ */
type Attribute = {
  id: string;
  name: string;
  slug: string;
  _count?: { terms: number };
};

/* ------------------------------------------------------------------ */
/*  Component                                                         */
/* ------------------------------------------------------------------ */
export function AttributeTable() {
  const router = useRouter();

  /* ── active organisation → permission hooks ─────────────────────── */
  const { data: activeOrg }       = authClient.useActiveOrganization();
  const organizationId            = activeOrg?.id ?? null;

  const {
    hasPermission: canView,
    isLoading:     permLoading,
  } = useHasPermission(organizationId, { productAttributes: ["view"] });

  const { hasPermission: canCreate } = useHasPermission(
    organizationId,
    { productAttributes: ["create"] },
  );
  const { hasPermission: canUpdate } = useHasPermission(
    organizationId,
    { productAttributes: ["update"] },
  );
  const { hasPermission: canDelete } = useHasPermission(
    organizationId,
    { productAttributes: ["delete"] },
  );

  /* ── local state ────────────────────────────────────────────────── */
  const [attributes,    setAttributes]    = useState<Attribute[]>([]);
  const [loading,       setLoading]       = useState(true);
  const [drawerOpen,    setDrawerOpen]    = useState(false);
  const [editingAttr,   setEditingAttr]   = useState<Attribute | null>(null);
  const [searchQuery,   setSearchQuery]   = useState("");

  /* ---------------------------------------------------------------- */
  /*  Data fetching                                                   */
  /* ---------------------------------------------------------------- */
  const fetchAttributes = async () => {
    try {
      const res = await fetch("/api/product-attributes?pageSize=100", {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to fetch attributes");
      const data = await res.json();
      setAttributes(data.attributes);
    } catch (err: any) {
      toast.error(err.message || "Failed to load attributes");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (permLoading) return;
    if (!canView) {
      router.replace("/dashboard");
      return;
    }
    fetchAttributes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [permLoading, canView]);

  /* ---------------------------------------------------------------- */
  /*  Event handlers                                                  */
  /* ---------------------------------------------------------------- */
  const handleDelete = async (id: string) => {
    if (!confirm("Delete this attribute (and all its terms)?")) return;
    try {
      const res = await fetch(`/api/product-attributes/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to delete");
      toast.success("Attribute deleted");
      fetchAttributes();
    } catch (err: any) {
      toast.error(err.message || "Failed to delete attribute");
    }
  };

  const openEdit   = (attr: Attribute) => { setEditingAttr(attr); setDrawerOpen(true); };
  const openCreate = ()                => { setEditingAttr(null); setDrawerOpen(true); };
  const closeDrawer= (refresh=false)   => {
    setDrawerOpen(false); setEditingAttr(null);
    if (refresh) fetchAttributes();
  };

  /* ---------------------------------------------------------------- */
  /*  Guards                                                          */
  /* ---------------------------------------------------------------- */
  if (permLoading) return null;
  if (!canView)    return null;   // redirected already

  /* ---------------------------------------------------------------- */
  /*  JSX                                                             */
  /* ---------------------------------------------------------------- */
  return (
    <div className="space-y-4">
      {/* Search + Add ------------------------------------------------ */}
      <div className="flex justify-between gap-4">
        <form
          onSubmit={(e)=>e.preventDefault()}
          className="flex w-full sm:w-auto gap-2"
        >
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              type="search"
              placeholder="Search attributes..."
              className="pl-8 w-full"
              value={searchQuery}
              onChange={(e)=>setSearchQuery(e.target.value)}
            />
          </div>
          <Button type="submit">Search</Button>
        </form>

        {canCreate && (
          <Button onClick={openCreate}>
            <Plus className="mr-2 h-4 w-4" />
            Add Attribute
          </Button>
        )}
      </div>

      {/* Table ------------------------------------------------------- */}
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
                  Loading…
                </TableCell>
              </TableRow>
            ) : attributes.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="h-24 text-center">
                  No attributes found.
                </TableCell>
              </TableRow>
            ) : (
              attributes
                .filter(a =>
                  a.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                  a.slug.toLowerCase().includes(searchQuery.toLowerCase()),
                )
                .map(attr => (
                  <TableRow key={attr.id}>
                    <TableCell
                      className="font-medium cursor-pointer"
                      onClick={() => router.push(`/product-attributes/${attr.id}/terms`)}
                    >
                      {attr.name}
                    </TableCell>
                    <TableCell>{attr.slug}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{attr._count?.terms ?? 0}</Badge>
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
                            <DropdownMenuItem onClick={() => openEdit(attr)}>
                              <Edit className="mr-2 h-4 w-4" /> Edit
                            </DropdownMenuItem>
                          )}
                          {canDelete && canUpdate && <DropdownMenuSeparator />}
                          {canDelete && (
                            <DropdownMenuItem
                              onClick={() => handleDelete(attr.id)}
                              className="text-destructive"
                            >
                              <Trash2 className="mr-2 h-4 w-4" /> Delete
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

      {/* Drawer ------------------------------------------------------ */}
      <AttributeDrawer
        open={drawerOpen}
        onClose={closeDrawer}
        attribute={editingAttr}
      />
    </div>
  );
}
