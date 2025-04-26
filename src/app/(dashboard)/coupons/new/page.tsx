// src/app/(dashboard)/clients/new/page.tsx
import { CouponForm } from "../coupons-form";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

export default function NewClientPage() {
  return (
    <div className="container mx-auto py-6 space-y-6">
      <div className="flex items-center gap-2">
        <Link href="/coupons">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Add New Coupon</h1>
          <p className="text-muted-foreground">Create a new coupon in your database</p>
        </div>
      </div>
      <CouponForm />
    </div>
  );
}