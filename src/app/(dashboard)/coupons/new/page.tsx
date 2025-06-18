"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { CouponForm } from "../coupons-form";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { usePermission } from "@/hooks/use-permission";

export default function NewCouponPage() {
  const router = useRouter();
  const can = usePermission();

  if (can.loading) return null;
  if (!can({ coupon: ["create"] })) {
    router.replace("/coupons");
    return null;
  }

  return (
    <div className="container mx-auto py-6 px-6 space-y-6">
      <div className="flex items-center gap-2">
        <Link href="/coupons">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Add New Coupon</h1>
          <p className="text-muted-foreground">
            Create a new coupon in your database
          </p>
        </div>
      </div>
      <CouponForm />
    </div>
  );
}
