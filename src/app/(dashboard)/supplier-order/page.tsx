// src/app/(dashboard)/purchase-supply-orders/page.tsx
"use client";
import { useEffect } from "react";

import PurchaseSupplyOrdersDataTable from "./components/purchase-supply-orders-data-table";

// Reusable info tooltip + dialog component
import InfoHelpDialog from "@/components/dashboard/info-help-dialog";
import { PageHeader } from "@/components/page-header";
import { useHeaderTitle } from "@/context/HeaderTitleContext"

export default function PurchaseSupplyOrdersPage() {
    const { setHeaderTitle } = useHeaderTitle()

    useEffect(() => {
        setHeaderTitle("Purchase orders") // Set the header title for this page
    }, [setHeaderTitle])
    return (
        <div className="container mx-auto py-6 px-6 space-y-6">
            <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                    <div>
                        <PageHeader
                            title="Purchase Orders"
                            description="Manage your purchase orders." />
                    </div>
                    {/* Use InfoHelpDialog with the new `content` prop */}
                    <InfoHelpDialog
                        title="About purchase orders"
                        tooltip="What are purchase orders?"
                        content={
                            <>
                                <p>
                                    <strong>Purchase orders</strong> are requests you send to suppliers to restock your inventory. They help you manage incoming stock, track costs, and maintain a clear purchasing history.
                                </p>
                                <p>
                                    Each purchase order includes supplier details, products, quantities, and pricing. As items are received, you can update the order to reflect what has arrived and automatically adjust your inventory levels.
                                </p>
                                <p>
                                    In the table below, you can view, edit, or track the status of purchase orders. Click the <strong>+</strong> button to create a new purchase order and begin the restocking process.
                                </p>
                            </>
                        }
                    />
                </div>
            </div>
            <PurchaseSupplyOrdersDataTable />
        </div>
    );
}
