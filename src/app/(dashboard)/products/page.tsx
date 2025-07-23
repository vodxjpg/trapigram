// src/app/(dashboard)/products/page.tsx
"use client";

import React, {
  useState,
  useRef,
  useEffect,
  Suspense,
  useCallback,
} from "react";
import { useRouter } from "next/navigation";
import { Plus, Upload, Download, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ProductsDataTable,
  type Product,
} from "./components/products-data-table";
import { PageHeader } from "@/components/page-header";
import { authClient } from "@/lib/auth-client";
import { useHasPermission } from "@/hooks/use-has-permission";
import { toast } from "sonner";

export default function ProductsPage() {
  const router = useRouter();

  // ── Pagination & Export Data ────────────────────────────────
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [currentProducts, setCurrentProducts] = useState<Product[]>([]);

  // ── Buttons & Import Modal State ────────────────────────────
  const [isLoading, setIsLoading] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [importMessage, setImportMessage] = useState<string | null>(null);
  const [importErrors, setImportErrors] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Active Org & Permissions ────────────────────────────────
  const { data: activeOrg } = authClient.useActiveOrganization();
  const organizationId = activeOrg?.id ?? null;
  const { hasPermission: canViewProducts, isLoading: permLoading } =
    useHasPermission(organizationId, { product: ["view"] });
  const { hasPermission: canCreateProducts } = useHasPermission(
    organizationId,
    { product: ["create"] }
  );

  // Redirect effect (doesn't change hook order)
  useEffect(() => {
    if (!permLoading && !canViewProducts) {
      router.replace("/dashboard");
    }
  }, [permLoading, canViewProducts, router]);

  const handleCreateProduct = () => router.push("/products/new");

  const openImportModal = () => {
    setImportMessage(null);
    setImportErrors([]);
    setShowImportModal(true);
  };

  const closeImportModal = () => {
    setShowImportModal(false);
    setIsImporting(false);
    setImportMessage(null);
    setImportErrors([]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const processFile = async (file: File) => {
    setIsImporting(true);
    setImportMessage(null);
    setImportErrors([]);
    const formData = new FormData();
    formData.append("file", file);
    try {
      const res = await fetch("/api/products/import", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      if (res.status === 207 && data.errors) {
        setImportMessage(`❌ Some rows failed to import`);
        setImportErrors(
          data.errors.map((e: any) => `Row ${e.row}: ${e.error}`)
        );
      } else if (!res.ok) {
        let error = "";
        for (const err of data.rowErrors) {
          error += `❌ ${err.error} in row ${err.row}.\n`;
        }
        setImportMessage(error);
      } else {
        setImportMessage(
          `✅ ${data.successCount} created. \n✅ ${data.editCount} updated.`
        );
        router.refresh();
      }
    } catch (err: any) {
      setImportMessage(`❌ ${err.message}`);
    } finally {
      setIsImporting(false);
    }
  };

  const handleFileChange = () => {
    const file = fileInputRef.current?.files?.[0];
    if (file) processFile(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file) processFile(file);
  };
  const handleDragOver = (e: React.DragEvent) => e.preventDefault();

  const handleExport = async () => {
    setIsExporting(true);
    try {
      const res = await fetch("/api/products/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ products: currentProducts }),
      });
      if (!res.ok) throw new Error("Export failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `products-page-${page}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setIsExporting(false);
    }
  };

  const handleProductsLoaded = useCallback((rows: Product[]) => {
    setCurrentProducts(rows);
  }, []);

  // If still loading perms, or user has no view perms, just render nothing.
  // (But we didn't return BEFORE hooks, so order is stable)
  if (permLoading || !canViewProducts) {
    return null;
  }

  return (
    <div className="container mx-auto py-6 px-6 space-y-6">
      {/* Hidden file input */}
      <Input
        ref={fileInputRef}
        id="file-upload"
        type="file"
        accept=".xlsx"
        onChange={handleFileChange}
        className="hidden"
      />

      {/* Import modal ... unchanged */}
      {showImportModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          {/* ... modal body unchanged ... */}
          {/* keep your existing modal JSX */}
        </div>
      )}

      <PageHeader
        title="Products"
        description="Manage your product catalog"
        actions={
          <div className="flex items-center gap-2">
            {canCreateProducts && (
              <Button
                variant="outline"
                onClick={openImportModal}
                disabled={isImporting}
              >
                <Upload className="mr-2 h-4 w-4" />
                Import
              </Button>
            )}
            {canCreateProducts && (
              <Button
                variant="outline"
                onClick={handleExport}
                disabled={isExporting}
              >
                <Download className="mr-2 h-4 w-4" />
                {isExporting ? "Exporting..." : "Export"}
              </Button>
            )}
            {canCreateProducts && (
              <Button onClick={handleCreateProduct} disabled={isLoading}>
                <Plus className="mr-2 h-4 w-4" />
                Add Product
              </Button>
            )}
          </div>
        }
      />

      <Suspense fallback={<div>Loading products table...</div>}>
        <ProductsDataTable
          page={page}
          pageSize={pageSize}
          onPageChange={setPage}
          onPageSizeChange={setPageSize}
          onProductsLoaded={handleProductsLoaded}
        />
      </Suspense>
    </div>
  );
}
