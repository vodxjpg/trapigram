"use client";

import { useParams } from "next/navigation";
import PurchaseOrderSupply from "../components/purchase-supply-orders-form";

export default function PurchaseSupplyOrdersPage() {
  const params = useParams<{ id?: string | string[] }>();
  const id = Array.isArray(params?.id) ? params.id[0] ?? "" : params?.id ?? "";
  return <PurchaseOrderSupply orderId={id} />;
}