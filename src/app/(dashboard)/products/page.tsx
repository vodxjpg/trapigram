"use client";

import React, { useState, useRef, useEffect, Suspense } from "react";
import { useRouter } from "next/navigation";
import { Plus, Upload, Download, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ProductsDataTable } from "./components/products-data-table";
import { PageHeader } from "@/components/page-header";
import { authClient } from "@/lib/auth-client";
import { useHasPermission } from "@/hooks/use-has-permission";
import { toast } from "sonner";

export default function ProductsPage() {
  const router = useRouter();

  /* ── active organisation ─────────────────────────────────── */
  const { data: activeOrg } = authClient.useActiveOrganization();
  const organizationId = activeOrg?.id ?? null;

  /* ── permission flags ────────────────────────────────────── */
  const { hasPermission: canViewProducts, isLoading: permLoading } =
    useHasPermission(organizationId, { product: ["view"] });

  const { hasPermission: canCreateProducts } = useHasPermission(
    organizationId,
    { product: ["create"] }
  );

  /* ── estado de botones ───────────────────────────────────── */
  const [isLoading, setIsLoading] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  /* ── estados modal import ────────────────────────────────── */
  const [showImportModal, setShowImportModal] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [importMessage, setImportMessage] = useState<string | null>(null);
  const [importErrors, setImportErrors] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  /* ── redirect if no visibility ───────────────────────────── */
  useEffect(() => {
    if (!permLoading && !canViewProducts) {
      router.replace("/dashboard");
    }
  }, [permLoading, canViewProducts, router]);

  if (permLoading || !canViewProducts) return null; // guard

  /* ── handlers ────────────────────────────────────────────── */
  const handleCreateProduct = () => {
    router.push("/products/new");
  };

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
      console.log(data);

      if (res.status === 207 && data.errors) {
        // Partial success with errors
        setImportMessage(`❌ Some rows failed to import`);
        setImportErrors(
          data.errors.map((e: any) => `Row ${e.row}: ${e.error}`)
        );
      } else if (!res.ok) {
        // General error
        setImportMessage(`❌ ${data.error || "Import failed"}`);
      } else {
        // Success
        setImportMessage(
          `✅ ${data.successCount} product(s) created successfully. \n✅ ${data.editCount} product(s) updated successfully.`
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
    // export logic...
  };

  return (
    <div className="container mx-auto py-6 px-6 space-y-6">
      {/* hidden file input */}
      <Input
        ref={fileInputRef}
        id="file-upload"
        type="file"
        accept=".xlsx"
        onChange={handleFileChange}
        className="hidden"
      />

      {/* import modal */}
      {showImportModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 w-full max-w-md relative">
            <button
              className="absolute top-4 right-4 text-gray-500 hover:text-gray-700"
              onClick={closeImportModal}
            >
              <X size={20} />
            </button>
            <h2 className="text-xl font-semibold mb-4">Import Products</h2>
            <p className="text-left"><a href="https://bjol9ok8s3a6bkjs.public.blob.vercel-storage.com/product-import-update-example-QF5kH2bLyT7dReogJAIYEuvvED6Ppl.xlsx" target="_blank">Download a template</a> to see the import format</p>
            <div
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              className="flex flex-col items-center justify-center border-2 border-dashed border-gray-300 rounded-lg p-6 cursor-pointer hover:border-gray-400 transition"
            >
              <Upload className="mb-2 h-6 w-6 text-gray-500" />
              <span className="font-medium">Drag &amp; Drop file here</span>
              <span className="text-sm text-gray-500 mt-1">
                or click to select
              </span>
              <Button
                variant="outline"
                className="mt-3"
                onClick={() => fileInputRef.current?.click()}
                disabled={isImporting}
              >
                Browse files
              </Button>
            </div>
            <div className="flex flex-col items-center text-left"><small><a href="/how-to-import-products" target="_blank">Learn how to import products</a></small></div>
            {importMessage && (
              <p
                className={`mt-4 text-center whitespace-pre-line font-medium ${
                  importMessage.startsWith("✅")
                    ? "text-green-600"
                    : "text-red-600"
                }`}
              >
                {importMessage}
              </p>
            )}

            {importErrors.length > 0 && (
              <ul className="mt-2 text-red-600 list-disc list-inside text-sm">
                {importErrors.map((err, i) => (
                  <li key={i}>{err}</li>
                ))}
              </ul>
            )}

            {isImporting && (
              <div className="absolute inset-0 bg-white/75 flex items-center justify-center rounded-xl">
                <span>Importing...</span>
              </div>
            )}
          </div>
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
            <Button
              variant="outline"
              onClick={handleExport}
              disabled={isExporting}
            >
              <Download className="mr-2 h-4 w-4" />
              {isExporting ? "Exporting..." : "Export"}
            </Button>
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
        <ProductsDataTable />
      </Suspense>
    </div>
  );
}
