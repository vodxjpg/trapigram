// src/app/(dashboard)/sections/sections-table.tsx
"use client";

import { useEffect, useState } from "react";
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
import {
  Table,
  TableHead,
  TableHeader,
  TableRow,
  TableBody,
  TableCell,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
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

type Section = {
  id: string;
  name: string;
  title: string;
  parentSectionId: string | null;
  videoUrl: string | null;
  updatedAt: string;
};

/* -------------------------------------------------- */
/* helpers                                            */
/* -------------------------------------------------- */
type Node = Section & { children: Node[] };
const buildTree = (list: Section[]): Node[] => {
  const map = new Map<string, Node>();
  const roots: Node[] = [];
  list.forEach((s) =>
    map.set(s.id, { ...s, children: [] }),
  );
  list.forEach((s) => {
    const node = map.get(s.id)!;
    if (s.parentSectionId) {
      map.get(s.parentSectionId)?.children.push(node);
    } else roots.push(node);
  });
  const sort = (arr: Node[]) =>
    arr.sort((a, b) => a.title.localeCompare(b.title)).forEach((n) => sort(n.children));
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

/* -------------------------------------------------- */
export function SectionsTable() {
  const router = useRouter();
  const [rows, setRows] = useState<Array<Section & { depth: number }>>([]);
  const [loading, setLoading] = useState(true);
  const [toDelete, setToDelete] = useState<Section | null>(null);

  /* pagination (simple client-side for now) */
  const pageSizeOptions = [10, 20, 50];
  const [pageSize, setPageSize] = useState(10);
  const [pageIndex, setPageIndex] = useState(0);

  const fetchSections = async () => {
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
  };
  useEffect(() => void fetchSections(), []);

  const paged = rows.slice(pageIndex * pageSize, (pageIndex + 1) * pageSize);
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));

  /* delete */
  const confirmDelete = async () => {
    if (!toDelete) return;
    try {
      const res = await fetch(`/api/sections/${toDelete.id}`, {
        method: "DELETE",
        headers: { "x-internal-secret": process.env.NEXT_PUBLIC_INTERNAL_API_SECRET || "" },
      });
      if (!res.ok) throw new Error();
      toast.success("Section deleted");
      await fetchSections();
    } catch {
      toast.error("Delete failed");
    } finally {
      setToDelete(null);
    }
  };

  return (
    <div className="space-y-4">
      {/* header */}
      <div className="flex justify-between">
        <h1 className="text-2xl font-semibold">Sections</h1>
        <Button onClick={() => router.push("/sections/new")}>
          <Plus className="mr-2 h-4 w-4" />
          New Section
        </Button>
      </div>

      {/* table */}
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Title</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Updated</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={5} className="h-24 text-center">
                  Loading…
                </TableCell>
              </TableRow>
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="h-24 text-center">
                  No sections yet.
                </TableCell>
              </TableRow>
            ) : (
              paged.map((s) => (
                <TableRow key={s.id}>
                  <TableCell>
                    <div style={{ paddingLeft: `${s.depth * 1.5}rem` }}>{s.title}</div>
                  </TableCell>
                  <TableCell>{s.name}</TableCell>
                  <TableCell>
                    {new Date(s.updatedAt).toLocaleString(undefined, {
                      dateStyle: "short",
                      timeStyle: "short",
                    })}
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
                          onClick={() => router.push(`/sections/${s.id}`)}
                        >
                          <Edit className="mr-2 h-4 w-4" />
                          Edit
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
            {pageSizeOptions.map((n) => (
              <option key={n}>{n}</option>
            ))}
          </select>
          <Button
            variant="outline"
            size="icon"
            onClick={() => setPageIndex(0)}
            disabled={pageIndex === 0}
          >
            <ChevronsLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            onClick={() => setPageIndex((p) => p - 1)}
            disabled={pageIndex === 0}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            onClick={() => setPageIndex((p) => p + 1)}
            disabled={pageIndex + 1 >= pageCount}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            onClick={() => setPageIndex(pageCount - 1)}
            disabled={pageIndex + 1 >= pageCount}
          >
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
