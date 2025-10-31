// src/app/(dashboard)/sections/components/sections-table.tsx
"use client";

import { useEffect, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  MoreVertical,
  Trash2,
  Edit,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
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
import { toast } from "sonner";
import { authClient } from "@/lib/auth-client";
import { useHasPermission } from "@/hooks/use-has-permission";

import {
  type ColumnDef,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { StandardDataTable } from "@/components/data-table/data-table";

type Section = {
  id: string;
  name: string;
  title: string;
  parentSectionId: string | null;
  videoUrl: string | null;
  updatedAt: string;
};
type Node = Section & { children: Node[] };

const buildTree = (list: Section[]): Node[] => {
  const map = new Map<string, Node>();
  const roots: Node[] = [];
  list.forEach((s) => map.set(s.id, { ...s, children: [] }));
  list.forEach((s) => {
    const node = map.get(s.id)!;
    if (s.parentSectionId) {
      map.get(s.parentSectionId)?.children.push(node);
    } else {
      roots.push(node);
    }
  });
  const sort = (arr: Node[]) =>
    arr
      .sort((a, b) => a.title.localeCompare(b.title))
      .forEach((n) => sort(n.children));
  sort(roots);
  return roots;
};

const flatten = (nodes: Node[], depth = 0): Array<Section & { depth: number }> => {
  const out: Array<Section & { depth: number }> = [];
  nodes.forEach((n) => {
    out.push({ ...n, depth });
    out.push(...flatten(n.children, depth + 1));
  });
  return out;
};

export function SectionsTable() {
  const router = useRouter();

  // permissions (hooks must be called unconditionally)
  const { data: activeOrg } = authClient.useActiveOrganization();
  const orgId = activeOrg?.id ?? null;

  const { hasPermission: canView, isLoading: viewLoading } = useHasPermission(orgId, { sections: ["view"] });
  const { hasPermission: canCreate, isLoading: createLoading } = useHasPermission(orgId, { sections: ["create"] });
  const { hasPermission: canUpdate, isLoading: updateLoading } = useHasPermission(orgId, { sections: ["update"] });
  const { hasPermission: canDelete, isLoading: deleteLoading } = useHasPermission(orgId, { sections: ["delete"] });

  // state (also unconditional)
  const [rows, setRows] = useState<Array<Section & { depth: number }>>([]);
  const [loading, setLoading] = useState(true);
  const [toDelete, setToDelete] = useState<Section | null>(null);
  const pageSizeOptions = [10, 20, 50];
  const [pageSize, setPageSize] = useState(10);
  const [pageIndex, setPageIndex] = useState(0);

  // fetch when allowed
  useEffect(() => {
    if (!canView) return;
    (async () => {
      setLoading(true);
      try {
        const res = await fetch("/api/sections?depth=10");
        if (!res.ok) throw new Error("Failed");
        const { sections } = await res.json();
        const tree = buildTree(sections);
        setRows(flatten(tree));
      } finally {
        setLoading(false);
      }
    })();
  }, [canView]);

  // redirect if no view permission
  useEffect(() => {
    if (!viewLoading && !canView) {
      router.replace("/dashboard");
    }
  }, [viewLoading, canView, router]);

  // derive pagination + columns (ALWAYS call hooks)
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  const paged = useMemo(
    () => rows.slice(pageIndex * pageSize, (pageIndex + 1) * pageSize),
    [rows, pageIndex, pageSize],
  );

  const columns = useMemo<ColumnDef<Section & { depth: number }>[]>(() => [
    {
      accessorKey: "title",
      header: "Title",
      cell: ({ row }) => (
        <div style={{ paddingLeft: `${row.original.depth * 1.5}rem` }}>
          {row.original.title}
        </div>
      ),
    },
    {
      accessorKey: "name",
      header: "Name",
      cell: ({ row }) => row.original.name,
    },
    {
      accessorKey: "updatedAt",
      header: "Updated",
      cell: ({ row }) =>
        new Date(row.original.updatedAt).toLocaleString(undefined, {
          dateStyle: "short",
          timeStyle: "short",
        }),
    },
    {
      id: "actions",
      header: () => <div className="text-right">Actions</div>,
      cell: ({ row }) => {
        const s = row.original;
        return (
          <div className="text-right">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon">
                  <MoreVertical className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {canUpdate && (
                  <DropdownMenuItem onClick={() => router.push(`/sections/${s.id}`)}>
                    <Edit className="mr-2 h-4 w-4" />
                    Edit
                  </DropdownMenuItem>
                )}
                {canDelete && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={() => setToDelete(s)}
                      className="text-destructive"
                    >
                      <Trash2 className="mr-2 h-4 w-4" />
                      Delete
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        );
      },
    },
  ], [canUpdate, canDelete, router]);

  // Create the table instance on every render (safe), but pass empty data until allowed
  const table = useReactTable({
    data: canView ? paged : [],
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  // after all hooks are called, it's safe to short-circuit UI
  if (viewLoading || createLoading || updateLoading || deleteLoading) return null;
  if (!canView) return null;

  const confirmDelete = async () => {
    if (!toDelete) return;
    try {
      const res = await fetch(`/api/sections/${toDelete.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      toast.success("Section deleted");
      // re-fetch
      setPageIndex(0);
      const resp = await fetch("/api/sections?depth=10");
      const { sections } = await resp.json();
      const tree = buildTree(sections);
      setRows(flatten(tree));
    } catch {
      toast.error("Delete failed");
    } finally {
      setToDelete(null);
    }
  };

  return (
    <div className="space-y-4">
      {/* header */}

      <StandardDataTable<Section & { depth: number }>
        table={table}
        columns={columns}
        isLoading={loading}
        emptyMessage="No sections yet."
      />

      {/* pagination */}
      <div className="flex items-center justify-between">
        <div className="text-sm text-muted-foreground">
          Page {pageIndex + 1} of {pageCount}
        </div>
        <div className="flex items-center space-x-2">
          <select
            value={pageSize}
            onChange={(e) => {
              setPageSize(Number(e.target.value));
              setPageIndex(0);
            }}
            className="border rounded px-2 py-1 text-sm"
          >
            {[10, 20, 50].map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
          <Button variant="outline" size="icon" onClick={() => setPageIndex(0)} disabled={pageIndex === 0}>
            <ChevronsLeft className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="icon" onClick={() => setPageIndex((p) => p - 1)} disabled={pageIndex === 0}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="icon" onClick={() => setPageIndex((p) => p + 1)} disabled={pageIndex + 1 >= pageCount}>
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="icon" onClick={() => setPageIndex(pageCount - 1)} disabled={pageIndex + 1 >= pageCount}>
            <ChevronsRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* delete dialog */}
      <AlertDialog open={!!toDelete} onOpenChange={(o) => !o && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete section?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes “{toDelete?.title}” and all its subsections.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
