"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { TicketsTable } from "./ticket-table";
import { useHeaderTitle } from "@/context/HeaderTitleContext";
import { usePermission } from "@/hooks/use-permission";
import { Suspense } from 'react'; // Added Suspense import

export default function CategoriesPage() {
    const { setHeaderTitle } = useHeaderTitle();

    useEffect(() => {
        setHeaderTitle("Tickets"); // Set the header title for this page
    }, [setHeaderTitle]);

    /* authz guard – runs once      */
  useEffect(() => {
    if (!can({ ticket: ["view"] })) router.replace("/403");
  }, [can, router]);

  /* if user cannot view, component immediately navigates away */
  if (!can({ ticket: ["view"] })) return null;

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