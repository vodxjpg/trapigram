// NEW FILE: src/app/(dashboard)/supplier-order/[id]/complete/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";

type Row = {
  productId: string;
  title: string;
  sku: string;
  quantity: number;     // ordered
  received: number;     // user input
};

export default function ReceiveOrderPage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const orderId = params.id;

  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<Row[]>([]);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const ctrl = new AbortController();
    (async () => {
      try {
        // 1) Load order to get the supplierCartId
        const orderRes = await fetch(`/api/suppliersOrder/${orderId}`, {
          cache: "no-store",
          signal: ctrl.signal,
        });
        if (!orderRes.ok) throw new Error("Failed to load order");
        const { order } = await orderRes.json();
        const cartId: string = order?.supplierCartId;

        // 2) Load cart lines for this order
        const linesRes = await fetch(`/api/suppliersCart/${cartId}`, {
          cache: "no-store",
          signal: ctrl.signal,
        });
        if (!linesRes.ok) throw new Error("Failed to load order items");
        const data = await linesRes.json();
        const items: any[] = data?.resultCartProducts ?? [];

        setRows(
          items.map((it) => ({
            productId: it.productId ?? it.id,
            title: it.title,
            sku: it.sku,
            quantity: Number(it.quantity ?? 0),
            received: Number(it.received ?? 0),
          }))
        );
      } catch (e: any) {
        if (e?.name !== "AbortError") toast.error(e?.message || "Failed to load");
      } finally {
        setLoading(false);
      }
    })();
    return () => ctrl.abort();
  }, [orderId]);

  const allMatched = useMemo(
    () => rows.every((r) => Number(r.received) === Number(r.quantity)),
    [rows]
  );

  const markAllGood = () => {
    setRows((prev) => prev.map((r) => ({ ...r, received: r.quantity })));
  };

  const setReceived = (idx: number, val: number) => {
    const n = Math.max(0, Number.isFinite(val) ? val : 0);
    setRows((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], received: n };
      return next;
    });
  };

  const completeOrder = async () => {
    try {
      setSubmitting(true);
      const payload = {
        status: "completed",
        received: rows.map((r) => ({
          productId: r.productId,
          quantityOrdered: r.quantity,
          received: r.received,
        })),
      };
      const res = await fetch(`/api/suppliersOrder/${orderId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(await res.text().catch(() => "Failed to complete order"));

      toast.success("Order completed");
      router.push("/supplier-order");
    } catch (e: any) {
      toast.error(e?.message || "Could not complete order");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="container mx-auto py-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Received Items</h1>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => router.push("/supplier-order")}>
            Go back
          </Button>
          <Button variant="secondary" onClick={markAllGood} disabled={loading || rows.length === 0}>
            Mark everything good
          </Button>
          <Button onClick={completeOrder} disabled={loading || submitting || rows.length === 0}>
            {submitting ? "Completing…" : "Complete Order"}
          </Button>
        </div>
      </div>

      <div className="rounded-md border overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>SKU</TableHead>
              <TableHead className="text-right">Ordered</TableHead>
              <TableHead className="text-right">Received</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={4}>Loading…</TableCell>
              </TableRow>
            ) : rows.length ? (
              rows.map((r, idx) => (
                <TableRow key={r.productId}>
                  <TableCell className="font-medium">{r.title}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{r.sku}</TableCell>
                  <TableCell className="text-right">{r.quantity}</TableCell>
                  <TableCell className="text-right">
                    <Input
                      type="number"
                      min={0}
                      value={r.received}
                      onChange={(e) => setReceived(idx, parseInt(e.target.value || "0", 10))}
                      className="w-28 ml-auto text-right"
                    />
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={4} className="text-center">
                  No items found for this order.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {!allMatched && rows.length > 0 && (
        <p className="text-sm text-amber-600">
          Warning: some received quantities do not match the ordered amounts.
        </p>
      )}
    </div>
  );
}
