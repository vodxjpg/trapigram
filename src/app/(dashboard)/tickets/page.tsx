"use client";

import { useEffect } from "react";
import { TicketsTable } from "./ticket-table";
import { useHeaderTitle } from "@/context/HeaderTitleContext";
import { Suspense } from 'react'; // Added Suspense import

export default function CategoriesPage() {
    const { setHeaderTitle } = useHeaderTitle();

    useEffect(() => {
        setHeaderTitle("Tickets"); // Set the header title for this page
    }, [setHeaderTitle]);

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold tracking-tight">Tickets</h1>
        <p className="text-muted-foreground">
          Manage your Tickets.
        </p>
      </div>
      <Suspense fallback={<div>Loading ticket table...</div>}>
        <TicketsTable />
      </Suspense>
    </div>
  );
}