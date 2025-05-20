"use client";
import { useParams } from "next/navigation";
import OrderForm from "../../create/orderForm";
export default function EditOrderPage() {
  const { id } = useParams<{ id: string }>();
  return <OrderForm orderId={id} />;
}
