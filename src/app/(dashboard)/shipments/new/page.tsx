"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { usePermission } from "@/hooks/use-permission";
import { ShipmentForm } from "../shipment-form";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

export default function NewShipmentPage() {
  const can = usePermission();
  const router = useRouter();

  // redirect if they can't create
  useEffect(() => {
    if (!can.loading && !can({ shipping: ["create"] })) {
      router.replace("/shipments");
    }
  }, [can, router]);

  if (can.loading) return null;

  return (
    <div className="container mx-auto py-6 px-6 space-y-6">
      <div className="flex items-center gap-2">
        <Link href="/shipments">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Add New Shippping method</h1>
          <p className="text-muted-foreground">
            Create a new shipping method
          </p>
        </div>
      </div>
      <ShipmentForm />
    </div>
  );
}
