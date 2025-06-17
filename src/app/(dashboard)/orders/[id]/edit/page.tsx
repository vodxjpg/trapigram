// app/orders/[id]/page.tsx
"use client";
import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import OrderFormVisual from "./orderForm";
import { usePermission } from "@/hooks/use-permission";

export default function OrderPage() {
  const { id } = useParams(); // pulls the [id] from the URL
  const router = useRouter();
   const can = usePermission();
   if (can.loading) return null;       
   /* ── redirect if the user has no right to view orders ─────────── */
if (!can({ order: ["view"] })) {
  // use a side-effect to avoid running during render
  useEffect(() => {
    router.replace("/orders");
  }, [router]);
  return null;  // nothing on screen during the redirect
}
  return <OrderFormVisual orderId={id} />;
}
