"use client";

import type React from "react";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { Plus, Upload, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ProductsDataTable } from "./components/products-data-table";
import { PageHeader } from "@/components/page-header";
import { Suspense } from "react";
import { usePermission } from "@/hooks/use-permission";
import { toast } from "sonner";

export default function ProductsPage() {
  const router = useRouter();
   const can = usePermission(); ;
  const [isLoading, setIsLoading] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Wait until we know the role
  if (can.loading) return null;

  // Deny access if user cannot view products
  if (!can({ product: ["view"] })) {
    return (
      <div className="container mx-auto py-6 px-6 text-center text-red-600">
        You don't have permission to view products.
      </div>
    );
  }

  const handleCreateProduct = () => {
    router.push("/products/new");
  };

  const handleImportClick = () => {
    setIsImporting(true);
    fileInputRef.current?.click();
  };

  const handleFileChange = async () => {
    const files = fileInputRef.current?.files;
    if (!files || files.length === 0) {
      setIsImporting(false);
      return;
    }
    const file = files[0];
    const formData = new FormData();
    formData.append("file", file);

    try {
      toast.loading("Importing file...");
      const res = await fetch("/api/products/import", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      console.log(data);
      if (!res.ok) {
        throw new Error(data.error || "Import failed");
      }
      toast.success("Products imported successfully");
      router.refresh();
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setIsImporting(false);
    }
  };

  const handleExport = async () => {
    setIsExporting(true);
  };

  return (
    <div className="container mx-auto py-6 px-6 space-y-6">
      {/* Hidden file input */}
      <Input
        ref={fileInputRef}
        type="file"
        accept=".xlsx"
        onChange={handleFileChange}
        className="hidden"
      />

      <PageHeader
        title="Products"
        description="Manage your product catalog"
        actions={
          <div className="flex items-center gap-2">
            {/* Import Button - only show if user can create products */}
            {can({ product: ["create"] }) && (
              <Button
                variant="outline"
                onClick={handleImportClick}
                disabled={isImporting}
              >
                <Upload className="mr-2 h-4 w-4" />
                {isImporting ? "Importing..." : "Import"}
              </Button>
            )}

            {/* Export Button - show if user can view products */}
            <Button
              variant="outline"
              onClick={handleExport}
              disabled={isExporting}
            >
              <Download className="mr-2 h-4 w-4" />
              {isExporting ? "Exporting..." : "Export"}
            </Button>

            {/* Original Add Product Button */}
            {can({ product: ["create"] }) && (
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
