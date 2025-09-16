// src/app/(dashboard)/purchase-supply-orders/page.tsx
import PurchaseSupplyOrdersDataTable from "./components/purchase-supply-orders-data-table";

export default function PurchaseSupplyOrdersPage() {
    return (
        <div className="p-6">
            <h1 className="mb-6 text-2xl font-semibold">Purchase Orders</h1>
            <PurchaseSupplyOrdersDataTable />
        </div>
    );
}
