"use client";


import { useRouter } from "next/navigation"
import { useEffect, useState } from "react";
import { CategoryTable } from "./category-table";
import { useHeaderTitle } from "@/context/HeaderTitleContext";
import { Suspense } from 'react'; // Added Suspense import
import { usePermission } from "@/hooks/use-permission"


export default function CategoriesPage() {
    const { setHeaderTitle } = useHeaderTitle();
    const router = useRouter()
     const can = usePermission(); 
    const [isLoading, setIsLoading] = useState(false)
    useEffect(() => {
        setHeaderTitle("Product categories"); // Set the header title for this page
    }, [setHeaderTitle]);

     // Wait until we know the role
  if (can.loading) return null
  
  // Deny access if user cannot view products
  if (!can({ product: ["view"] })) {
    return (
      <div className="container mx-auto py-6 px-6 text-center text-red-600">
        You don’t have permission to view product categories.
      </div>
    )
  } 

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold tracking-tight">Categories</h1>
        <p className="text-muted-foreground">
          Manage your product categories and their organization.
        </p>
      </div>
      <Suspense fallback={<div>Loading categories table...</div>}>
        <CategoryTable />
      </Suspense>
    </div>
  );
}
