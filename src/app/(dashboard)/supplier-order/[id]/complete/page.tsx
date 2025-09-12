// NEW FILE: src/app/(dashboard)/supplier-order/[id]/complete/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { Edit, X } from "lucide-react";

type Row = {
  productId: string;
  title: string;
  sku: string;
  quantity: number;     // ordered
  received: number;     // user input
};

type Warehouse = { id: string; name: string; countries: string[] };
type GridCell = { ordered: number; received: number };
type Grid = Record<string, Record<string, GridCell>>; // wid -> country -> cell

export default function ReceiveOrderPage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const orderId = params.id;

  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<Row[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [resultLines, setResultLines] = useState<any[]>([]); // raw per-warehouse/country rows from API (`result`)

  // Drawer state (per-product receive allocations)
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingProductId, setEditingProductId] = useState<string | null>(null);
  const [perProductGrids, setPerProductGrids] = useState<Record<string, Grid>>({});
  //perProductGrids: productId -> warehouseId -> country -> { ordered, received }

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
        const { result, resultCartProducts } = data
        setResultLines(Array.isArray(result) ? result : []);
        const items: any[] = resultCartProducts ?? [];

        setRows(
          items.map((it) => ({
            productId: it.productId ?? it.id,
            title: it.title,
            sku: it.sku,
            quantity: Number(it.quantity ?? 0),
            // If API returns aggregated `received`, use it as initial value; otherwise start at 0.
            received: Number.isFinite(Number(it.received)) ? Number(it.received) : 0,
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

  // Ensure warehouses list (same API used in creation view)
  const ensureWarehouses = async (): Promise<Warehouse[]> => {
    if (warehouses.length) return warehouses;
    const res = await fetch("/api/warehouses", {
      headers: { "x-internal-secret": process.env.NEXT_PUBLIC_INTERNAL_API_SECRET! },
      cache: "no-store",
    });
    if (!res.ok) throw new Error("Failed to load warehouses");
    const data = await res.json();
    const whs: Warehouse[] = data?.warehouses ?? [];
    setWarehouses(whs);
    return whs;
  };

  // Build a per-warehouse/country grid using ONLY warehouses/countries present in `resultLines`
  const buildGridForProduct = (pid: string): Grid => {
    const base: Grid = {};
    const lines = resultLines.filter((rl) => (rl.productId ?? rl.id) === pid);
    for (const r of lines) {
      const wid = r.warehouseId;
      const ct = r.country;
      const ordered = Number(r.quantity ?? 0) || 0;
      const rec = Number(r.received ?? 0) || 0;
      if (!base[wid]) base[wid] = {};
      base[wid][ct] = { ordered, received: rec };
    }
    return base;
  };

  const sumGrid = (g?: Grid) =>
    g
      ? Object.values(g).reduce(
        (acc, byCt) => acc + Object.values(byCt).reduce((s, cell) => s + (Number(cell.received) || 0), 0),
        0
      )
      : 0;
  const sumGridOrdered = (g?: Grid) =>
    g
      ? Object.values(g).reduce(
        (acc, byCt) => acc + Object.values(byCt).reduce((s, cell) => s + (Number(cell.ordered) || 0), 0),
        0
      )
      : 0;


  const allMatched = useMemo(
    () => rows.every((r) => Number(r.received) === Number(r.quantity)),
    [rows]
  );

  const markAllGood = async () => {
    try {
      // Ensure every product has a grid (built from `result` only), then set received = ordered for each cell.
      setPerProductGrids((prev) => {
        const next = { ...prev };
        for (const r of rows) {
          const existing = next[r.productId] ?? buildGridForProduct(r.productId);
          const cloned: Grid = {};
          for (const [wid, byCt] of Object.entries(existing)) {
            cloned[wid] = {};
            for (const [ct, cell] of Object.entries(byCt)) {
              cloned[wid][ct] = { ordered: cell.ordered, received: cell.ordered };
            }
          }
          next[r.productId] = cloned;
        }
        return next;
      });
      setRows((prev) => prev.map((r) => ({ ...r, received: r.quantity })));
    } catch (e: any) {
      toast.error(e?.message || "Could not mark as received");
    }
  };

  // Open drawer for a product, populate grid if needed
  const openReceiveDrawer = async (pid: string) => {
    try {
      await ensureWarehouses(); // for names; rendering still filters by `result`
      setPerProductGrids((prev) => {
        if (prev[pid]) return prev; // already built/edited
        return { ...prev, [pid]: buildGridForProduct(pid) };
      });
      setEditingProductId(pid);
      setDrawerOpen(true);
    } catch (e: any) {
      toast.error(e?.message || "Could not open receive editor");
    }
  };

  // Change a single cell's received value (clamped between 0 and ordered)
  const changeReceived = (wid: string, country: string, value: number) => {
    if (!editingProductId) return;
    const pid = editingProductId;
    setPerProductGrids((prev) => {
      const grid = prev[pid] ?? {};
      const byCt = grid[wid] ?? {};
      const cell = byCt[country] ?? { ordered: 0, received: 0 };
      const n = Math.max(0, Math.min(Number(cell.ordered) || 0, Number.isFinite(value) ? value : 0));
      return {
        ...prev,
        [pid]: {
          ...grid,
          [wid]: {
            ...byCt,
            [country]: { ...cell, received: n },
          },
        },
      };
    });
  };

  // Save drawer: update aggregated "rows.received" for the product
  const saveReceive = () => {
    if (!editingProductId) return;
    const pid = editingProductId;
    const total = sumGrid(perProductGrids[pid]);
    setRows((prev) => prev.map((r) => (r.productId === pid ? { ...r, received: total } : r)));
    setDrawerOpen(false);
    setEditingProductId(null);
  };

  /**
   * Build the detailed "received" payload:
   * - Prefer the edited drawer grid (perProductGrids) for each product.
   * - If a product has no grid yet, derive it from `resultLines` (API response)
   *   so we still send warehouse/country breakdowns.
   */
  const buildReceivedPayload = () => {
    type Line = {
      productId: string;
      warehouseId: string;
      country: string;
      quantityOrdered: number;
      received: number;
    };
    const out: Line[] = [];

    // Iterate over all products visible in the table
    for (const r of rows) {
      const pid = r.productId;
      // use existing edited grid or build from API result
      const grid: Grid = perProductGrids[pid] ?? buildGridForProduct(pid);
      for (const [wid, byCt] of Object.entries(grid)) {
        for (const [ct, cell] of Object.entries(byCt)) {
          const ordered = Number((cell as GridCell).ordered ?? 0) || 0;
          const rec = Number((cell as GridCell).received ?? 0) || 0;
          // Skip completely empty lines (no ordered & no received)
          if (ordered === 0 && rec === 0) continue;
          out.push({
            productId: pid,
            warehouseId: wid,
            country: ct,
            quantityOrdered: ordered,
            received: rec,
          });
        }
      }
    }
    return out;
  };


  const completeOrder = async () => {
    try {
      setSubmitting(true);
      const payload = {
        status: "completed",
        // include per-warehouse & per-country lines
        received: buildReceivedPayload(),
      };
      const res = await fetch(`/api/suppliersOrder/${orderId}/complete`, {
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
              rows.map((r) => {
                const grid = perProductGrids[r.productId];
                const totalReceived = grid ? sumGrid(grid) : r.received;
                return (
                  <TableRow key={r.productId}>
                    <TableCell className="font-medium">{r.title}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{r.sku}</TableCell>
                    <TableCell className="text-right">{r.quantity}</TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="outline"
                        size="sm"
                        className="ml-auto flex items-center gap-2"
                        onClick={() => openReceiveDrawer(r.productId)}
                      >
                        <span>{totalReceived ?? 0}</span>
                        <Edit className="h-4 w-4 text-gray-500" />
                      </Button>
                    </TableCell>
                  </TableRow>
                )
              })
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
      {/* Drawer: per-warehouse/country received editor */}
      <Drawer
        open={drawerOpen}
        onOpenChange={(open) => {
          setDrawerOpen(open);
          if (!open) setEditingProductId(null);
        }}
      >
        <DrawerContent
          className="
            fixed inset-x-0 bottom-0 top-auto w-full
            rounded-t-2xl border-t bg-background p-0
            data-[state=open]:animate-in data-[state=open]:slide-in-from-bottom-10
            data-[state=closed]:animate-out data-[state=closed]:slide-out-to-bottom-10
            h-[85vh] sm:h-[85vh]
          "
        >
          <DrawerHeader className="px-6 py-4">
            <div className="flex items-center justify-between">
              <DrawerTitle className="text-base sm:text-lg">
                Receive —{" "}
                <span className="font-normal">
                  {editingProductId ? rows.find((x) => x.productId === editingProductId)?.title : ""}
                </span>
              </DrawerTitle>
              <DrawerClose asChild>
                <Button variant="ghost" size="icon" aria-label="Close">
                  <X className="h-5 w-5" />
                </Button>
              </DrawerClose>
            </div>
            {editingProductId && (
              <DrawerDescription className="mt-1">
                Enter received units per warehouse &amp; country. Total Received:{" "}
                <span className="font-medium">
                  {sumGrid(perProductGrids[editingProductId])}
                </span>{" "}
                / Ordered:{" "}
                <span className="font-medium">
                  {sumGridOrdered(perProductGrids[editingProductId])}
                </span>
              </DrawerDescription>
            )}
          </DrawerHeader>

          <Separator />

          <div className="overflow-y-auto px-6 py-4 h=[calc(85vh-9rem)] sm:h-[calc(85vh-9rem)]">
            {(() => {
              if (!editingProductId) {
                return <p className="text-sm text-muted-foreground">No product selected.</p>;
              }
              const grid = perProductGrids[editingProductId] || {};
              const activeWids = Object.keys(grid); // only warehouses present in `result`
              if (activeWids.length === 0) {
                return <p className="text-sm text-muted-foreground">No warehouse entries for this product.</p>;
              }
              const byId = new Map(warehouses.map((w) => [w.id, w]));
              return (
                <div className="space-y-6">
                  {activeWids.map((wid) => {
                    const w = byId.get(wid);
                    const title = w?.name ?? `Warehouse ${wid}`;
                    const countries = Object.keys(grid[wid] || {});
                    return (
                      <div key={wid} className="space-y-3">
                        <div className="flex items-center justify-between">
                          <h3 className="font-medium">{title}</h3>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                          {countries.map((c) => {
                            const cell: GridCell = grid?.[wid]?.[c] ?? { ordered: 0, received: 0 };
                            const disabled = (cell.ordered ?? 0) === 0;
                            return (
                              <div
                                key={`${wid}-${c}`}
                                className="rounded-md border p-3 flex flex-col gap-2"
                              >
                                <div className="flex items-center justify-between text-sm">
                                  <span>{c}</span>
                                  <span className="text-muted-foreground">Ordered: {cell.ordered}</span>
                                </div>
                                <div>
                                  <Label className="text-xs">Received</Label>
                                  <Input
                                    inputMode="numeric"
                                    type="number"
                                    min={0}
                                    className="mt-1 w-full"
                                    value={cell.received}
                                    onChange={(e) =>
                                      changeReceived(
                                        wid,
                                        c,
                                        parseInt(e.target.value.replace(/\D/g, "") || "0", 10)
                                      )
                                    }
                                    disabled={disabled}
                                    placeholder={disabled ? "No units ordered" : undefined}
                                  />
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })()}
          </div>

          <Separator />

          <DrawerFooter className="px-6 py-4">
            <div className="flex items-center justify-end gap-2">
              <DrawerClose asChild>
                <Button variant="outline">Cancel</Button>
              </DrawerClose>
              <Button onClick={saveReceive} disabled={!editingProductId}>
                Save
              </Button>
            </div>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>
    </div>
  );
}
