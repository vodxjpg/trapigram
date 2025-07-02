"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { usePermission } from "@/hooks/use-permission";
import { Button } from "@/components/ui/button";
import { ShippingMethodForm } from "../shipping-companies-form";

export default function NewShippingMethodPage() {
  const router = useRouter();
  const can = usePermission(organizationId);;

  // 1) Wait for permissions to load
  useEffect(() => {
    if (!can.loading && !can({ shippingMethods: ["create"] })) {
      router.replace("/shipping-companies");
    }
  }, [can, router]);

  // 2) If still loading or no create access, don't render form
  if (can.loading || !can({ shippingMethods: ["create"] })) {
    return null;
  }

  return (
    <div className="container mx-auto py-6 px-6 space-y-6">
      <div className="flex items-center gap-2">
        <Link href="/shipping-companies">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Add New Shipping Company</h1>
          <p className="text-muted-foreground">
            Create a new shipping company.
          </p>
        </div>
      </div>
      <ShippingMethodForm />
    </div>
  );
}
