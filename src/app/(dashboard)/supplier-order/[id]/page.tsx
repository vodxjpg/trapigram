// src/app/(dashboard)/supplier-order/[id]/page.tsx
import PurchaseOrderSupply from "../components/purchase-supply-orders-form";

export default function PurchaseSupplyOrdersPage({
    params,
}: { params: { id: string } }) {
    return <PurchaseOrderSupply orderId={params.id} />;
}