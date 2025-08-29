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
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type OrderField = "createdAt" | "updatedAt" | "title" | "sku";
type OrderDir = "asc" | "desc";

type ExportQuery = {
  search: string;
  status?: "published" | "draft";
  categoryId?: string;
  attributeTermId?: string;
  orderBy: OrderField;
  orderDir: OrderDir;
};

export default function ProductsPage() {
  const router = useRouter();

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [currentProducts, setCurrentProducts] = useState<Product[]>([]);

  const [isLoading, setIsLoading] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [importMessage, setImportMessage] = useState<string | null>(null);
  const [importErrors, setImportErrors] = useState<string[]>([]);
  const [showExportDialog, setShowExportDialog] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 👇 lifted query/sort state for export
  const [exportQuery, setExportQuery] = useState<ExportQuery>({
    search: "",
    status: undefined,
    categoryId: undefined,
    attributeTermId: undefined,
    orderBy: "createdAt",
    orderDir: "desc",
  });

  const { data: activeOrg } = authClient.useActiveOrganization();
  const organizationId = activeOrg?.id ?? null;
  const userEmail = authClient.useSession()?.data?.user?.email;

  const { hasPermission: canViewProducts, isLoading: permLoading } =
    useHasPermission(organizationId, { product: ["view"] });
  const { hasPermission: canCreateProducts } = useHasPermission(
    organizationId,
    { product: ["create"] }
  );

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

  const handleFileChange = () => {
    const file = fileInputRef.current?.files?.[0];
    if (file) processFile(file);
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

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file) processFile(file);
  };
  const handleDragOver = (e: React.DragEvent) => e.preventDefault();

  /**
   * Export ALL products matching current filters/sort by delegating to the server.
   * We forward the lifted `exportQuery` so the API can iterate `/api/products`.
   */
  const handleExport = async () => {
    setIsExporting(true);
    try {
      const res = await fetch("/api/products/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          exportAll: true,
          query: exportQuery,
          userEmail: userEmail,
        }),
      });

      if (!res.ok) throw new Error("Export failed");

      if (res.headers.get("Content-Type")?.includes("application/json")) {
        const result = await res.json();
        if (result.sentToEmail) {
          setShowExportDialog(true);
          // ✅ new toast notification
          toast.success(
            "Your export is large and will be sent to your registered email."
          );
          return;
        }
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `products-all.xlsx`;
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

  // receive filter/sort state from table
  const handleQueryStateChange = useCallback((q: ExportQuery) => {
    setExportQuery(q);
  }, []);

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

      <Dialog open={showExportDialog} onOpenChange={setShowExportDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Export Sent by Email</DialogTitle>
          </DialogHeader>
          <p>
            Your export contains many rows and has been sent to your email
            address.
          </p>
          <DialogFooter>
            <Button onClick={() => setShowExportDialog(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Import modal ... unchanged */}
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
            <p className="text-left">
              <a
                className="text-blue-600"
                href="https://bjol9ok8s3a6bkjs.public.blob.vercel-storage.com/product-import-update-example-QF5kH2bLyT7dReogJAIYEuvvED6Ppl.xlsx"
                target="_blank"
              >
                Download a template
              </a>{" "}
              to see the import format
            </p>
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
            <div className="flex flex-col justify-center text-left mt-2">
              <small className="text-blue-600">
                <a href="/import-products" target="_blank">
                  Learn how to import products
                </a>
              </small>
            </div>
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
          // 👇 NEW: lift query/sort state up
          onQueryStateChange={handleQueryStateChange}
        />
      </Suspense>
    </div>
  );
}
