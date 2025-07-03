"use client";

import type React from "react";

import { useState, useRef, useEffect, Suspense } from "react";
import { useRouter }               from "next/navigation";
import { Plus, Upload, Download }  from "lucide-react";
import { Button }                  from "@/components/ui/button";
import { Input }                   from "@/components/ui/input";
import { ProductsDataTable }       from "./components/products-data-table";
import { PageHeader }              from "@/components/page-header";
import { authClient }              from "@/lib/auth-client";
import { useHasPermission }        from "@/hooks/use-has-permission";
import { toast }                   from "sonner";

export default function ProductsPage() {
  const router = useRouter();

  
  /* ── active organisation ─────────────────────────────────── */
  const { data: activeOrg }  = authClient.useActiveOrganization();
  const organizationId       = activeOrg?.id ?? null;

  /* ── permission flags (new hook) ─────────────────────────── */
  const {
    hasPermission: canViewProducts,
    isLoading:     permLoading,
  } = useHasPermission(organizationId, { product: ["view"] });

  const { hasPermission: canCreateProducts } = useHasPermission(
    organizationId,
    { product: ["create"] },
  );
  const [isLoading, setIsLoading] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
   /* ── redirect if no visibility ───────────────────────────── */
   useEffect(() => {
     if (!permLoading && !canViewProducts) {
       router.replace("/dashboard");
     }
   }, [permLoading, canViewProducts, router]);
  
   if (permLoading || !canViewProducts) return null;  // guard while resolving

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
            {canCreateProducts && (
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
