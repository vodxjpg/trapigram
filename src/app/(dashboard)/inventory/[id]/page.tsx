// src/app/(dashboard)/inventory/[id]/page.tsx
// MODIFIED: InventoryDetailPage with discrepancy modal
"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { authClient } from "@/lib/auth-client";
import { useHasPermission } from "@/hooks/use-has-permission";

// ★ Components extracted earlier
import CountInfo from "./components/count-info";
import InventoryItems from "./components/inventory-items";

/**
 * Inventory metadata
 */
type InventoryData = {
  id: string;
  reference: string;
  name: string;
  countType: "all" | "specific";
  createdAt: string;
  username: string;
  email: string;
  isCompleted: boolean;
  isCounted: boolean;
};

// change the type
interface Product {
  id: string;                // composite row key for the table
  productId: string;         // ✅ ALWAYS base product id (from API "productId")
  name: string;
  sku: string;
  expectedQuantity: number;
  countedQuantity: number | null;
  country: string;
  variationId: string | null;  // ✅ can be null
  isCounted: boolean;
  discrepancyReason: string;
}

/**
 * Helper: send PATCH with full product fields, countedQuantity and optional reason.
 */
const saveProductCount = async (
  inventoryId: string,
  product: Omit<Product, "countedQuantity">,
  countedQuantity: number,
  discrepancyReason?: string
) => {
  const payload: {
    productId: string;
    country: string;
    countedQuantity: number;
    variationId?: string | null;
    discrepancyReason?: string;
  } = {
    productId: product.productId,     // ✅ base product id
    country: product.country,
    countedQuantity,
  };

  // include only if present
  if (product.variationId) payload.variationId = product.variationId;
  if (discrepancyReason && discrepancyReason.trim()) {
    payload.discrepancyReason = discrepancyReason.trim();
  }

  return fetch(`/api/inventory/${inventoryId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
};

export default function InventoryDetailPage() {
  const { id } = useParams();
  const router = useRouter();

  // permissions
  const { data: activeOrg } = authClient.useActiveOrganization();
  const orgId = activeOrg?.id ?? null;
  const { hasPermission: canView, isLoading: viewLoading } = useHasPermission(
    orgId,
    { stockManagement: ["view"] }
  );
  const { hasPermission: canUpdate, isLoading: updateLoading } =
    useHasPermission(orgId, { stockManagement: ["update"] });

  useEffect(() => {
    if (!viewLoading && !canView) router.replace("/inventory");
  }, [viewLoading, canView, router]);

  // ❌ Don’t early-return before hooks
  const permsLoading = viewLoading || updateLoading;
  const canShow = !permsLoading && canView;

  const [inventory, setInventory] = useState<InventoryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [products, setProducts] = useState<Product[]>([]);
  const [countriesToBeCounted, setCountriesToBeCounted] = useState<string[]>(
    []
  );
  const [countriesCounted, setCountriesCounted] = useState<string[]>([]);
  const [savingRows, setSavingRows] = useState<Record<string, boolean>>({});
  const setSaving = (rowId: string, v: boolean) =>
    setSavingRows((prev) => ({ ...prev, [rowId]: v }));

  const [currentPage, setCurrentPage] = useState(1);
  const [countedValues, setCountedValues] = useState<Record<string, string>>(
    {}
  );
  const itemsPerPage = 10;

  const [showDiscrepancyModal, setShowDiscrepancyModal] = useState(false);
  const [discrepancyReason, setDiscrepancyReason] = useState("");
  const [pendingProductId, setPendingProductId] = useState<string | null>(null);

  // Check if there are any products not yet counted
  const hasUncountedProducts = products.some((p) => !p.isCounted);

  // Final condition for disabling the Continue button
  const disableContinue =
    hasUncountedProducts || inventory?.isCompleted === true;

  const fetchInventory = useCallback(async () => {
    setLoading(true);
    try {
      if (!canView) return; // guard
      const response = await fetch(`/api/inventory/${id}`);
      if (!response.ok) throw new Error("Inventory not found");
      const data = await response.json();
      const { inventory, countProduct } = data;
      setInventory(inventory);

      // when mapping API → UI
      const parsedProducts: Product[] = countProduct.map((p: any) => ({
        id: `${p.id}:${p.variationId ?? "no-var"}:${p.country}`,
        productId: p.productId,
        name: p.title,
        sku: p.sku,
        expectedQuantity: Number(p.expectedQuantity ?? 0),          // ✅ force number
        countedQuantity: p.countedQuantity != null
          ? Number(p.countedQuantity)                                // ✅ force number
          : null,
        country: p.country,
        variationId: p.variationId ?? null,
        isCounted: Boolean(p.isCounted),
        discrepancyReason: p.discrepancyReason ?? "",
      }));
      setProducts(parsedProducts);

      const toBeCountedCountries = parsedProducts
        .filter((p) => !p.isCounted)
        .map((p) => p.country);
      setCountriesToBeCounted(Array.from(new Set(toBeCountedCountries)));

      const countedCountries = parsedProducts
        .filter((p) => p.isCounted)
        .map((p) => p.country);
      setCountriesCounted(Array.from(new Set(countedCountries)));
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [id, canView]);

  useEffect(() => {
    if (id) fetchInventory();
  }, [id, fetchInventory]);

  const handleCountedChange = (productId: string, value: string) => {
    setCountedValues((prev) => ({ ...prev, [productId]: value }));
  };

  // Optimistically mark a row as counted and re-slice the country tabs
  const applyLocalSave = (rowId: string, qty: number, reason?: string) => {
    setProducts((prev) => {
      const next = prev.map((p) =>
        p.id === rowId
          ? {
            ...p,
            countedQuantity: qty,
            isCounted: true,
            discrepancyReason: reason ?? p.discrepancyReason,
          }
          : p
      );

      // recompute the country lists from the updated products
      const toBe = Array.from(
        new Set(next.filter((p) => !p.isCounted).map((p) => p.country))
      );
      const done = Array.from(
        new Set(next.filter((p) => p.isCounted).map((p) => p.country))
      );
      setCountriesToBeCounted(toBe);
      setCountriesCounted(done);

      return next;
    });

    // clear the input value for that row
    setCountedValues((prev) => {
      const copy = { ...prev };
      delete copy[rowId];
      return copy;
    });
  };

  const confirmDiscrepancySave = async () => {
    if (!canUpdate || !pendingProductId) return;
    const product = products.find((p) => p.id === pendingProductId);
    const raw = countedValues[pendingProductId];
    if (!product || raw == null) return;

    const numeric = Number(raw);
    if (!Number.isFinite(numeric) || numeric < 0) return;

    // Only include reason if provided
    const reason = discrepancyReason.trim();
    applyLocalSave(pendingProductId, numeric, reason || undefined);

    // Close modal & reset UI
    setShowDiscrepancyModal(false);
    setDiscrepancyReason("");
    const rowId = pendingProductId;
    setPendingProductId(null);

    // Persist in background
    setSaving(rowId, true);
    try {
      await saveProductCount(id!, { ...product }, numeric, reason || undefined);
    } catch (e) {
      console.error(e);
    } finally {
      setSaving(rowId, false);
    }
  };

  const handleSave = async (rowId: string) => {
    if (!canUpdate) return;
    const product = products.find((p) => p.id === rowId);
    const raw = countedValues[rowId];
    if (!product || raw == null) return;

    const numeric = Number(String(raw).trim());                  // ✅ number
    const expected = Number(product.expectedQuantity ?? 0);       // ✅ number

    if (!Number.isFinite(numeric) || numeric < 0) return;

    // ✅ numeric-only comparison
    if (numeric !== expected) {
      setPendingProductId(rowId);
      setShowDiscrepancyModal(true);
      return;
    }

    applyLocalSave(rowId, numeric);
    setSaving(rowId, true);
    try {
      await saveProductCount(id!, { ...product }, numeric);
    } finally {
      setSaving(rowId, false);
    }
  };

  // Gate AFTER hooks are declared
  if (permsLoading) {
    return <p className="p-4 text-sm text-muted-foreground">Loading…</p>;
  }
  if (!canShow) {
    return null; // redirect effect runs
  }

  if (loading) return <p className="p-4 text-sm">Loading...</p>;
  if (error) return <p className="p-4 text-sm text-red-500">{error}</p>;
  if (!inventory) return <p className="p-4 text-sm">Inventory not found.</p>;

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      <h1 className="text-2xl font-semibold text-gray-900">Inventory Count Details</h1>

      {/* First Card - Count Info (moved into component) */}
      <CountInfo inventory={inventory} />

      {/* Second Card - Products (moved into component) */}
      <InventoryItems
        products={products}
        countriesToBeCounted={countriesToBeCounted}
        countriesCounted={countriesCounted}
        itemsPerPage={itemsPerPage}
        currentPage={currentPage}
        setCurrentPage={setCurrentPage}
        countedValues={countedValues}
        handleCountedChange={handleCountedChange}
        canUpdate={canUpdate}
        savingRows={savingRows}
        handleSave={handleSave}
      />

      {/* Discrepancy Modal */}
      {/* ✅ Control the Dialog solely by local state, not by permissions */}
      <Dialog
        open={showDiscrepancyModal}
        onOpenChange={(next) => setShowDiscrepancyModal(next)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Discrepancy Reason</DialogTitle>
          </DialogHeader>
          <p>
            The counted quantity differs from the expected. Please explain why:
          </p>
          <Textarea
            value={discrepancyReason}
            onChange={(e) => setDiscrepancyReason(e.target.value)}
            placeholder="Explain discrepancy..."
            disabled={!canUpdate}
          />
          <DialogFooter>
            <Button
              onClick={() => setShowDiscrepancyModal(false)}
              variant="outline"
            >
              Cancel
            </Button>
            <Button
              onClick={confirmDiscrepancySave}
              disabled={!canUpdate}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── Footer Actions ─── */}
      <div className="flex justify-end gap-3 mt-8">
        <Button
          variant="outline"
          onClick={() => router.push("/inventory")}
          className="px-6"
        >
          Go back
        </Button>

        <Button
          onClick={() =>
            inventory?.id &&
            (async () => {
              try {
                const res = await fetch(`/api/inventory/${inventory.id}/complete`, {
                  method: "PATCH",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ id: inventory.id }),
                });
                if (!res.ok) {
                  const err = await res.json().catch(() => ({}));
                  throw new Error(err.error || "Failed to complete inventory");
                }
                await res.json();
                setInventory((prev) => (prev ? { ...prev, isCompleted: true } : prev));
                router.replace("/inventory");
              } catch (err: any) {
                console.error(err);
                alert(err.message || "Something went wrong");
              }
            })()
          }
          disabled={disableContinue}
          className={`px-6 ${disableContinue ? "bg-gray-200 text-gray-500 cursor-not-allowed hover:bg-gray-200" : ""
            }`}
        >
          Continue
        </Button>
      </div>
    </div>
  );
}
