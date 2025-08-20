// /src/app/(dashboard)/affiliates/logs-table.tsx
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, Clock } from "lucide-react";
import { toast } from "sonner";

/* ───────────── Types ───────────── */
type Log = {
  id: string;
  organizationId: string;
  clientId: string;
  points: number;
  action: string;
  description: string | null;
  sourceClientId: string | null;
  createdAt: string;
  clientLabel?: string;
  sourceClientLabel?: string;
};

type ClientBrief = {
  id: string;
  userId?: string | null;
  username: string | null;
  firstName: string | null;
  lastName: string | null;
};

/* ───────────── Component ───────────── */
export function LogsTable() {
  const [logs, setLogs] = useState<Log[]>([]);
  const [loading, setLoading] = useState(true);
  const [totalPages, setTotalPages] = useState(1);
  const [page, setPage] = useState(1);
  const pageSize = 20;



  /* fetch logs */
  const loadLogs = async () => {
    setLoading(true);
    try {
      const r = await fetch(
        `/api/affiliate/points?page=${page}&pageSize=${pageSize}`,
        {
          headers: {
            "x-internal-secret":
              process.env.NEXT_PUBLIC_INTERNAL_API_SECRET ?? "",
          },
        }
      );
      if (!r.ok) throw new Error((await r.json()).error || "Fetch failed");
      const { logs, totalPages, currentPage } = await r.json();
      setLogs(logs);
      setTotalPages(totalPages);
      setPage(currentPage);



    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => void loadLogs(), [page]);

  /* helper */
  const fallbackId = (id: string | null | undefined) =>
    id ? id.slice(0, 8) + "…" : "-";

  /* ───────────── JSX ───────────── */
  return (
    <Card className="p-4">
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>ID</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Client</TableHead>
              <TableHead>Δ Points</TableHead>
              <TableHead>Action</TableHead>
              <TableHead>Description</TableHead>
              <TableHead>Source Client</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center">
                  Loading logs…
                </TableCell>
              </TableRow>
            ) : logs.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center">
                  No logs
                </TableCell>
              </TableRow>
            ) : (
              logs.map((l) => (
                <TableRow key={l.id}>
                  <TableCell className="font-mono text-xs">
                    {l.id.slice(0, 8)}…
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <Clock className="h-4 w-4 opacity-70" />
                      {new Date(l.createdAt).toLocaleString()}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Link href={`/clients/${l.clientId}/info`}>
                      {l.clientLabel || fallbackId(l.clientId)}
                    </Link>
                  </TableCell>
                  <TableCell
                    className={
                      l.points >= 0 ? "text-green-600" : "text-red-600"
                    }
                  >
                    {l.points > 0 ? "+" : ""}
                    {l.points}
                  </TableCell>
                  <TableCell>{l.action}</TableCell>
                  <TableCell>{l.description ?? "-"}</TableCell>
                  <TableCell>
                    {l.sourceClientId ? (
                      <Link href={`/clients/${l.sourceClientId}/info`}>
                        {l.sourceClientLabel || fallbackId(l.sourceClientId)}
                      </Link>
                    ) : (
                      "-"
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* pagination */}
      <div className="flex items-center justify-between mt-4">
        <span className="text-sm text-muted-foreground">
          Page {page} of {totalPages}
        </span>
        <div className="flex items-center space-x-2">
          <Button
            variant="outline"
            size="icon"
            onClick={() => setPage(1)}
            disabled={page === 1 || loading}
          >
            <ChevronLeft className="h-4 w-4" />
            <ChevronLeft className="h-4 w-4 -ml-2" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            onClick={() => setPage((p) => p - 1)}
            disabled={page === 1 || loading}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            onClick={() => setPage((p) => p + 1)}
            disabled={page === totalPages || loading}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            onClick={() => setPage(totalPages)}
            disabled={page === totalPages || loading}
          >
            <ChevronRight className="h-4 w-4" />
            <ChevronRight className="h-4 w-4 -ml-2" />
          </Button>
        </div>
      </div>
    </Card>
  );
}
