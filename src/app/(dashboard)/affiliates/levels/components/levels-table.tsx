// src/app/(dashboard)/affiliates/levels-table.tsx
"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { MoreVertical, Edit, Trash2 } from "lucide-react";

// ⬇️ TanStack + standardized table
import { useReactTable, getCoreRowModel, type ColumnDef } from "@tanstack/react-table";
import { StandardDataTable } from "@/components/data-table/data-table";

type Level = {
  id: string;
  name: string;
  image: string | null;
  requiredPoints: number;
  createdAt: string;
};

export function LevelsTable() {
  const router = useRouter();
  const [levels, setLevels] = useState<Level[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/affiliate/levels", {
        headers: {
          "x-internal-secret": process.env.NEXT_PUBLIC_INTERNAL_API_SECRET ?? "",
        },
      });
      if (!r.ok) throw new Error((await r.json()).error || "Fetch failed");
      const { levels } = await r.json();
      setLevels(levels);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => void load(), [load]);

  const deleteLevel = useCallback(
    async (id: string) => {
      if (!confirm("Delete this level?")) return;
      try {
        const r = await fetch(`/api/affiliate/levels/${id}`, {
          method: "DELETE",
          headers: {
            "x-internal-secret": process.env.NEXT_PUBLIC_INTERNAL_API_SECRET ?? "",
          },
        });
        if (!r.ok) throw new Error((await r.json()).error || "Delete failed");
        toast.success("Level deleted");
        load();
      } catch (e: any) {
        toast.error(e.message);
      }
    },
    [load]
  );

  const columns = useMemo<ColumnDef<Level>[]>(() => {
    return [
      {
        accessorKey: "name",
        header: "Name",
      },
      {
        id: "image",
        header: "Image",
        cell: ({ row }) =>
          row.original.image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={row.original.image!}
              alt={row.original.name}
              className="h-8 w-8 rounded object-cover"
            />
          ) : (
            <span>-</span>
          ),
        enableSorting: false,
      },
      {
        accessorKey: "requiredPoints",
        header: "Required Points",
      },
      {
        accessorKey: "createdAt",
        header: "Created",
        cell: ({ row }) => new Date(row.original.createdAt).toLocaleDateString(),
      },
      {
        id: "actions",
        header: "",
        enableSorting: false,
        enableHiding: false,
        cell: ({ row }) => {
          const l = row.original;
          return (
            <div className="text-right">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <MoreVertical className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="end"
                  onCloseAutoFocus={(e) => e.preventDefault()}
                >
                  <DropdownMenuItem
                    onSelect={(e) => {
                      e.preventDefault();
                      router.push(`/affiliates/levels/${l.id}`);
                    }}
                  >
                    <Edit className="mr-2 h-4 w-4" />
                    Edit
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className="text-destructive focus:text-destructive"
                    onSelect={(e) => {
                      e.preventDefault();
                      deleteLevel(l.id);
                    }}
                  >
                    <Trash2 className="mr-2 h-4 w-4" />
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          );
        },
      },
    ];
  }, [router, deleteLevel]);

  const table = useReactTable({
    data: levels,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  return (
    <StandardDataTable
      table={table}
      columns={columns}
      isLoading={loading}
      skeletonRows={Math.min(8, Math.max(3, levels.length || 5))}
      emptyMessage="No levels yet"
    />
  );
}
