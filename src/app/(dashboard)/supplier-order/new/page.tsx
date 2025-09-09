import PurchaseOrderSupply from "../components/purchase-supply-orders-form";

export default function PurchaseSupplyOrdersPage() {
    return (
        <div className="p-6">
            <h1 className="mb-6 text-2xl font-semibold">Purchase Supply Orders</h1>
            <PurchaseOrderSupply />
        </div>
    );
}
