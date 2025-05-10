"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";
import { MoreVertical, Edit, Trash2 } from "lucide-react";

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

  const load = async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/affiliate/levels", {
        headers: { "x-internal-secret": process.env.NEXT_PUBLIC_INTERNAL_API_SECRET ?? "" },
      });
      if (!r.ok) throw new Error((await r.json()).error || "Fetch failed");
      const { levels } = await r.json();
      setLevels(levels);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => void load(), []);

  const deleteLevel = async (id: string) => {
    if (!confirm("Delete this level?")) return;
    try {
      const r = await fetch(`/api/affiliate/levels/${id}`, {
        method: "DELETE",
        headers: { "x-internal-secret": process.env.NEXT_PUBLIC_INTERNAL_API_SECRET ?? "" },
      });
      if (!r.ok) throw new Error((await r.json()).error || "Delete failed");
      toast.success("Level deleted");
      load();
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  return (
    <Card className="p-4">
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Image</TableHead>
              <TableHead>Required Points</TableHead>
              <TableHead>Created</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center">
                  Loading…
                </TableCell>
              </TableRow>
            ) : levels.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center">
                  No levels yet
                </TableCell>
              </TableRow>
            ) : (
              levels.map((l) => (
                <TableRow key={l.id}>
                  <TableCell>{l.name}</TableCell>
                  <TableCell>
                    {l.image ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={l.image} alt={l.name} className="h-8 w-8 rounded object-cover" />
                    ) : (
                      "-"
                    )}
                  </TableCell>
                  <TableCell>{l.requiredPoints}</TableCell>
                  <TableCell>{new Date(l.createdAt).toLocaleDateString()}</TableCell>
                  <TableCell className="text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon">
                          <MoreVertical className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => router.push(`/affiliates/levels/${l.id}`)}>
                          <Edit className="mr-2 h-4 w-4" />
                          Edit
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => deleteLevel(l.id)}
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
    </Card>
  );
}
