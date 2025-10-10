// MODIFIED: InventoryDetailPage with discrepancy modal
"use client";

import { useCallback } from "react";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { useRouter } from "next/navigation";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { authClient } from "@/lib/auth-client";
import { useHasPermission } from "@/hooks/use-has-permission";

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
  const setSaving = (id: string, v: boolean) =>
    setSavingRows((prev) => ({ ...prev, [id]: v }));

  const [currentPage, setCurrentPage] = useState(1);
  const [countedValues, setCountedValues] = useState<Record<string, string>>(
    {}
  );
  const itemsPerPage = 10;

  const [showDiscrepancyModal, setShowDiscrepancyModal] = useState(false);
  const [discrepancyReason, setDiscrepancyReason] = useState("");
  const [pendingProductId, setPendingProductId] = useState<string | null>(null);

  // For the "to be counted" countries
  const [tbcTab, setTbcTab] = useState<string>(""); // to-be-counted
  const [cntTab, setCntTab] = useState<string>(""); // counted

  // Check if there are any products not yet counted
  const hasUncountedProducts = products.some((p) => !p.isCounted);

  // Final condition for disabling the Continue button
  const disableContinue =
    hasUncountedProducts || inventory?.isCompleted === true;

  useEffect(() => {
    if (countriesToBeCounted.length === 0) {
      setTbcTab("");
      return;
    }
    if (!countriesToBeCounted.includes(tbcTab)) {
      setTbcTab(countriesToBeCounted[0]); // pick the first available
    }
  }, [countriesToBeCounted, tbcTab]);

  useEffect(() => {
    if (countriesCounted.length === 0) {
      setCntTab("");
      return;
    }
    if (!countriesCounted.includes(cntTab)) {
      setCntTab(countriesCounted[0]);
    }
  }, [countriesCounted, cntTab]);

  const fetchInventory = useCallback(async () => {
    setLoading(true);
    try {
      if (!canView) return; // guard
      const response = await fetch(`/api/inventory/${id}`);
      if (!response.ok) throw new Error("Inventory not found");
      const data = await response.json();
      console.log(data)
      const { inventory, countProduct } = data;
      console.log(inventory);
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


  // ─── Function to complete inventory ───
  async function completeInventory(inventoryId: string) {
    try {
      const res = await fetch(`/api/inventory/${inventoryId}/complete`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: inventoryId }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to complete inventory");
      }

      await res.json();

      // update local state so UI reflects immediately
      setInventory((prev) => (prev ? { ...prev, isCompleted: true } : prev));

      // 🔁 redirect to /inventory
      router.replace("/inventory");
    } catch (err: any) {
      console.error(err);
      alert(err.message || "Something went wrong");
    }
  }

  const getFilteredProducts = (
    country: string,
    status: "to-be-counted" | "counted"
  ) => {
    return products.filter((product) => {
      return (
        product.country === country &&
        (status === "to-be-counted"
          ? product.isCounted === false
          : product.isCounted === true)
      );
    });
  };

  const ProductTable = ({
    country,
    status,
  }: {
    country: string;
    status: "to-be-counted" | "counted";
  }) => {
    const filteredProducts = getFilteredProducts(country, status);
    const totalPages = Math.ceil(filteredProducts.length / itemsPerPage);
    const paginatedProducts = filteredProducts.slice(
      (currentPage - 1) * itemsPerPage,
      currentPage * itemsPerPage
    );

    const isCountedView = status === "counted";

    return (
      <div className="space-y-4">
        <div className="text-sm text-gray-600 mb-4">
          Showing products for {country} -{" "}
          {isCountedView ? "Counted" : "To be counted"}
        </div>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>SKU</TableHead>
              <TableHead>Expected Quantity</TableHead>
              <TableHead>Counted Quantity</TableHead>
              {isCountedView ? (
                <TableHead>Discrepancy Reason</TableHead>
              ) : (
                <TableHead>Action</TableHead>
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {paginatedProducts.map((product) => (
              <TableRow key={product.id}>
                <TableCell className="font-medium">{product.name}</TableCell>
                <TableCell>{product.sku}</TableCell>
                <TableCell>{product.expectedQuantity}</TableCell>
                <TableCell>
                  {isCountedView ? (
                    <span className="text-gray-900">
                      {product.countedQuantity}
                    </span>
                  ) : (
                    <Input
                      type="number"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      min={0}
                      step={1}
                      placeholder="0"
                      value={countedValues[product.id] ?? ""}                       // don’t coerce to falsy
                      onChange={(e) => handleCountedChange(product.id, e.target.value)}
                      className="w-20"
                      disabled={!canUpdate || !!savingRows[product.id]}
                    />
                  )}
                </TableCell>

                {isCountedView ? (
                  <TableCell>
                    {product.discrepancyReason?.trim()
                      ? product.discrepancyReason
                      : "-"}
                  </TableCell>
                ) : (
                  <TableCell>
                    <Button
                      size="sm"
                      onClick={() => handleSave(product.id)}
                      disabled={
                        countedValues[product.id] === undefined ||                 // ✅ allow "0"
                        countedValues[product.id] === "" ||
                        !canUpdate ||
                        !!savingRows[product.id]
                      }
                    >
                      Save
                    </Button>
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>

        {/* Pagination */}
        <div className="flex items-center justify-between">
          <div className="text-sm text-gray-600">
            Showing {(currentPage - 1) * itemsPerPage + 1} to{" "}
            {Math.min(currentPage * itemsPerPage, filteredProducts.length)} of{" "}
            {filteredProducts.length} products
          </div>
          <div className="flex items-center space-x-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCurrentPage((prev) => Math.max(prev - 1, 1))}
              disabled={currentPage === 1}
            >
              <ChevronLeft className="h-4 w-4" />
              Previous
            </Button>
            <span className="text-sm">
              Page {currentPage} of {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                setCurrentPage((prev) => Math.min(prev + 1, totalPages))
              }
              disabled={currentPage === totalPages}
            >
              Next
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
    );
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
      <h1 className="text-2xl font-semibold text-gray-900">
        Inventory Count Details
      </h1>

      {/* First Card - Count Info */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg font-medium text-black">
            Count info
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-8">
            <div className="space-y-4">
              <div className="flex justify-between items-center py-2">
                <span className="text-sm font-medium text-gray-900">
                  Created by
                </span>
                <span className="text-sm text-gray-600">
                  {inventory.username} - {inventory.email}
                </span>
              </div>
              <div className="flex justify-between items-center py-2">
                <span className="text-sm font-medium text-gray-900">
                  Warehouse
                </span>
                <span className="text-sm text-gray-600">{inventory.name}</span>
              </div>
              <div className="flex justify-between items-center py-2">
                <span className="text-sm font-medium text-gray-900">
                  Reference
                </span>
                <span className="text-sm text-gray-600">
                  {inventory.reference}
                </span>
              </div>
            </div>
            <div className="space-y-4">
              <div className="flex justify-between items-center py-2">
                <span className="text-sm font-medium text-gray-900">
                  Count type
                </span>
                <span className="text-sm text-gray-600">
                  {inventory.countType}
                </span>
              </div>
              <div className="flex justify-between items-center py-2">
                <span className="text-sm font-medium text-gray-900">
                  Count started on
                </span>
                <span className="text-sm text-gray-600">
                  {new Date(inventory.createdAt).toLocaleString()}
                </span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Second Card - Products */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg font-medium text-black">
            Inventory Items
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="to-be-counted" className="w-full">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="to-be-counted">To be counted</TabsTrigger>
              <TabsTrigger value="counted">Counted</TabsTrigger>
            </TabsList>

            <TabsContent value="to-be-counted" className="mt-4">
              <Tabs
                defaultValue={countriesToBeCounted[0] || ""}
                className="w-full"
              >
                <TabsList className="flex flex-wrap gap-2 w-full">
                  {countriesToBeCounted.map((country) => (
                    <TabsTrigger key={country} value={country}>
                      {country}
                    </TabsTrigger>
                  ))}
                </TabsList>

                {countriesToBeCounted.map((country) => (
                  <TabsContent key={country} value={country} className="mt-4">
                    <ProductTable country={country} status="to-be-counted" />
                  </TabsContent>
                ))}
              </Tabs>
            </TabsContent>

            <TabsContent value="counted" className="mt-4">
              <Tabs defaultValue={countriesCounted[0] || ""} className="w-full">
                <TabsList className="flex flex-wrap gap-2 w-full">
                  {countriesCounted.map((country) => (
                    <TabsTrigger key={country} value={country}>
                      {country}
                    </TabsTrigger>
                  ))}
                </TabsList>

                {countriesCounted.map((country) => (
                  <TabsContent key={country} value={country} className="mt-4">
                    <ProductTable country={country} status="counted" />
                  </TabsContent>
                ))}
              </Tabs>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      {/* Discrepancy Modal */}
      <Dialog
        open={showDiscrepancyModal && canUpdate}
        onOpenChange={setShowDiscrepancyModal}
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
              disabled={!canUpdate} // ⬅️ removed the `!discrepancyReason.trim()` part
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
          onClick={() => inventory?.id && completeInventory(inventory.id)}
          disabled={disableContinue}
          className={`px-6 ${disableContinue
            ? "bg-gray-200 text-gray-500 cursor-not-allowed hover:bg-gray-200"
            : ""
            }`}
        >
          Continue
        </Button>
      </div>
    </div>
  );
}
