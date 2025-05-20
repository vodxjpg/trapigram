// app/orders/[id]/page.tsx
"use client";

import { useParams } from "next/navigation";
import OrderFormVisual from "./orderForm";

export default function OrderPage() {
  const { id } = useParams(); // pulls the [id] from the URL
  return <OrderFormVisual orderId={id} />;
}
