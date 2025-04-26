"use client";

import { useEffect } from "react";
import { ReviewsTable } from "./review-table";
import { useHeaderTitle } from "@/context/HeaderTitleContext";

export default function CategoriesPage() {
    const { setHeaderTitle } = useHeaderTitle();

    useEffect(() => {
        setHeaderTitle("Reviews"); // Set the header title for this page
    }, [setHeaderTitle]);

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold tracking-tight">Reviews</h1>
        <p className="text-muted-foreground">
          Manage your Reviews.
        </p>
      </div>
      <ReviewsTable />
    </div>
  );
}