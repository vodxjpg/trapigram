// src/app/(dashboard)/supplier-order/[id]/complete/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
  variationId: string | null;
  title: string;
  sku: string;
  quantity: number;
  received: number;
};

type CatalogItem = { id: string; variationId: string | null; title: string; sku: string };

type Warehouse = { id: string; name: string; countries: string[] };
type GridCell = { ordered: number; received: number };
type Grid = Record<string, Record<string, GridCell>>; // wid -> country -> cell
type SupplierInfo = { name: string | null; email: string | null; phone: string | null };

// helper: consistent key for rows/grids
const keyForRow = (r: Row) => r.variationId ?? r.productId;

export default function ReceiveOrderPage() {
  const router = useRouter();
  const params = useParams<{ id?: string | string[] }>();
  const orderId = Array.isArray(params?.id) ? params.id?.[0] ?? "" : params?.id ?? "";

  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<Row[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [resultLines, setResultLines] = useState<any[]>([]); // raw per-warehouse/country rows from API (`result`)
  const [supplier, setSupplier] = useState<SupplierInfo | null>(null);

  // Drawer state (per-product receive allocations)
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingProductId, setEditingProductId] = useState<string | null>(null); // key is variationId ?? productId
  const [perProductGrids, setPerProductGrids] = useState<Record<string, Grid>>({});
  // perProductGrids: key -> warehouseId -> country -> { ordered, received }
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);

  // load catalog (for proper titles/skus for variants)
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/products?page=1&pageSize=1000&ownedOnly=1", { cache: "no-store" });
        if (!res.ok) return;
        const j = await res.json();
        const flat = Array.isArray(j?.productsFlat) ? j.productsFlat : [];
        setCatalog(
          flat.map((p: any) => ({
            id: p.id,
            variationId: p.variationId ?? null,
            title: p.title,
            sku: p.sku,
          }))
        );
      } catch {
        // noop
      }
    })();
  }, []);

  // rehydrate row titles/skus from catalog when both are loaded
  useEffect(() => {
    if (!catalog.length || !rows.length) return;
    setRows(prev =>
      prev.map(r => {
        const m = catalog.find(
          c => c.id === r.productId && (c.variationId ?? null) === (r.variationId ?? null)
        );
        return m ? { ...r, title: m.title, sku: m.sku } : r;
      })
    );
  }, [catalog, rows.length]);

  // load order + cart lines
  useEffect(() => {
    if (!orderId) return;
    const ctrl = new AbortController();
    (async () => {
      try {
        // 1) Load order to get the supplierCartId (and supplier info)
        const orderRes = await fetch(`/api/suppliersOrder/${orderId}`, {
          cache: "no-store",
          signal: ctrl.signal,
        });
        if (!orderRes.ok) throw new Error("Failed to load order");
        const { order } = await orderRes.json();
        const sup: SupplierInfo = {
          name: order?.supplier?.name ?? order?.supplierName ?? order?.name ?? null,
          email: order?.supplier?.email ?? order?.supplierEmail ?? order?.email ?? null,
          phone: order?.supplier?.phone ?? order?.supplierPhone ?? order?.phone ?? null,
        };
        setSupplier(sup);
        const cartId: string = order?.supplierCartId;
        if (!cartId) throw new Error("Order has no supplier cart");

        // 2) Load cart lines for this order
        const linesRes = await fetch(`/api/suppliersCart/${cartId}`, {
          cache: "no-store",
          signal: ctrl.signal,
        });
        if (!linesRes.ok) throw new Error("Failed to load order items");
        const data = await linesRes.json();
        const per = Array.isArray(data?.result) ? data.result : [];
        setResultLines(per);

        // Group by productId + variationId
        const byKey = new Map<string, Row>();
        for (const it of per) {
          const pid = it.productId ?? it.id;
          const vid = it.variationId ?? null;
          const k = `${pid}:${vid ?? "base"}`;
          const qty = Number(it.quantity ?? 0) || 0;
          const rec = Number(it.received ?? 0) || 0;

          const cur = byKey.get(k);
          if (!cur) {
            byKey.set(k, {
              productId: pid,
              variationId: vid,
              title: it.title, // temporary; rehydrated later
              sku: it.sku,     // temporary
              quantity: qty,
              received: rec,
            });
          } else {
            cur.quantity += qty;
            cur.received += rec;
          }
        }
        setRows(Array.from(byKey.values()));
      } catch (e: any) {
        if (e?.name !== "AbortError") toast.error(e?.message || "Failed to load");
      } finally {
        setLoading(false);
      }
    })();
    return () => ctrl.abort();
  }, [orderId]);

  // Ensure warehouses list
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
  const buildGridForKey = (key: string): Grid => {
    const base: Grid = {};

    // If key matches any variationId in lines, treat as variant key; else treat as productId
    const matchesVariant = resultLines.some((rl: any) => (rl.variationId ?? null) === key);
    const lines = resultLines.filter((rl: any) =>
      matchesVariant ? (rl.variationId ?? null) === key : (rl.productId ?? rl.id) === key
    );

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
      setPerProductGrids((prev) => {
        const next = { ...prev };
        for (const r of rows) {
          const key = keyForRow(r);
          const existing = next[key] ?? buildGridForKey(key);
          const cloned: Grid = {};
          for (const [wid, byCt] of Object.entries(existing)) {
            cloned[wid] = {};
            for (const [ct, cell] of Object.entries(byCt)) {
              const c = cell as GridCell;
              cloned[wid][ct] = { ordered: c.ordered, received: c.ordered };
            }
          }
          next[key] = cloned;
        }
        return next;
      });

      setRows((prev) => prev.map((r) => ({ ...r, received: r.quantity })));
    } catch (e: any) {
      toast.error(e?.message || "Could not mark as received");
    }
  };

  // Open drawer for a product, using the consistent key
  const openReceiveDrawer = async (key: string) => {
    try {
      await ensureWarehouses();
      setPerProductGrids((prev) => {
        if (prev[key]) return prev;
        return { ...prev, [key]: buildGridForKey(key) };
      });
      setEditingProductId(key);
      setDrawerOpen(true);
    } catch (e: any) {
      toast.error(e?.message || "Could not open receive editor");
    }
  };

  // Change a single cell's received value (clamped between 0 and ordered)
  const changeReceived = (wid: string, country: string, value: number) => {
    if (!editingProductId) return;
    setPerProductGrids((prev) => {
      const grid = prev[editingProductId] ?? {};
      const byCt = grid[wid] ?? {};
      const cell = byCt[country] ?? { ordered: 0, received: 0 };
      const n = Math.max(0, Math.min(Number(cell.ordered) || 0, Number.isFinite(value) ? value : 0));
      return {
        ...prev,
        [editingProductId]: {
          ...grid,
          [wid]: {
            ...byCt,
            [country]: { ...cell, received: n },
          },
        },
      };
    });
  };

  // Save drawer: update aggregated "rows.received" for the matching key (variant or product)
  const saveReceive = () => {
    if (!editingProductId) return;
    const total = sumGrid(perProductGrids[editingProductId]);
    setRows((prev) =>
      prev.map((r) => (keyForRow(r) === editingProductId ? { ...r, received: total } : r))
    );
    setDrawerOpen(false);
    setEditingProductId(null);
  };

  // Build payload for completion (warehouse/country breakdown)
  const buildReceivedPayload = () => {
    type Line = {
      productId: string;
      variationId?: string | null;
      warehouseId: string;
      country: string;
      quantityOrdered: number;
      received: number;
    };

    const out: Line[] = [];

    for (const r of rows) {
      const key = keyForRow(r);
      const grid: Grid = perProductGrids[key] ?? buildGridForKey(key);

      for (const [wid, byCt] of Object.entries(grid)) {
        for (const [ct, cell] of Object.entries(byCt)) {
          const ordered = Number((cell as GridCell).ordered ?? 0) || 0;
          const rec = Number((cell as GridCell).received ?? 0) || 0;
          if (ordered === 0 && rec === 0) continue;

          out.push({
            productId: r.productId,
            variationId: r.variationId ?? null,
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
      {/* Supplier Information card (top of page) */}
      <Card className="my-10 sm:my-8">
        <CardHeader className="pb-2">
          <CardTitle>Supplier Information</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <div className="text-xs text-muted-foreground">Name</div>
              <div className="font-medium">
                {supplier?.name ?? (loading ? "Loading…" : "—")}
              </div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Email</div>
              <div className="font-medium">
                {supplier?.email ? <a href={`mailto:${supplier.email}`}>{supplier.email}</a> : (loading ? "Loading…" : "—")}
              </div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Phone</div>
              <div className="font-medium">
                {supplier?.phone ?? (loading ? "Loading…" : "—")}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

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
                const key = keyForRow(r);
                const grid = perProductGrids[key];
                const totalReceived = grid ? sumGrid(grid) : r.received;
                return (
                  <TableRow key={`${r.productId}:${r.variationId ?? "base"}`}>
                    <TableCell className="font-medium">{r.title}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{r.sku}</TableCell>
                    <TableCell className="text-right">{r.quantity}</TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="outline"
                        size="sm"
                        className="ml-auto flex items-center gap-2"
                        onClick={() => openReceiveDrawer(key)}
                      >
                        <span>{totalReceived ?? 0}</span>
                        <Edit className="h-4 w-4 text-gray-500" />
                      </Button>
                    </TableCell>
                  </TableRow>
                );
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
                  {editingProductId
                    ? rows.find((x) => keyForRow(x) === editingProductId)?.title
                    : ""}
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
