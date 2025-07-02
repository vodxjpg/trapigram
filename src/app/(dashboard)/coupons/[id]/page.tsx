// src/app/(dashboard)/clients/[id]/page.tsx
"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { CouponForm } from "../coupons-form";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { Skeleton } from "@/components/ui/skeleton";
import { usePermission } from "@/hooks/use-permission";

export default function EditCouponPage() {
  const { id } = useParams();
  const router = useRouter();
  const can = usePermission(organizationId);;
  const [coupon, setCoupon] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  // redirect away if no update
  useEffect(() => {
    if (!can.loading && !can({ coupon: ["update"] })) {
      router.replace("/coupons");
    }
  }, [can, router]);
  if (can.loading || !can({ coupon: ["update"] })) return null;

  useEffect(() => {
    fetch(`/api/coupons/${id}`)
      .then((res) => {
        if (!res.ok) throw new Error("Failed to fetch");
        return res.json();
      })
      .then(setCoupon)
      .catch((e) => {
        toast.error(e.message);
        router.push("/coupons");
      })
      .finally(() => setLoading(false));
  }, [id, router]);

  return (
    <div className="container mx-auto py-6 px-6 space-y-6">
      <div className="flex items-center gap-2">
        <Link href="/coupons">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-3xl font-bold">Edit Coupon</h1>
          <p className="text-muted-foreground">
            Update coupon information
          </p>
        </div>
      </div>

      {loading ? (
        <div className="space-y-4">
          <Skeleton className="h-12 w-full" />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
          <Skeleton className="h-10 w-32 mx-auto" />
        </div>
      ) : (
        <CouponForm couponData={coupon} isEditing={true} />
      )}
    </div>
  );
}
