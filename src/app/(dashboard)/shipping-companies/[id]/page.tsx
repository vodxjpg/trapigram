// src/app/(dashboard)/clients/[id]/page.tsx
"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { ShippingMethodForm } from "../shipping-companies-form";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { Skeleton } from "@/components/ui/skeleton";

export default function EditClientPage() {
  const params = useParams();
  const router = useRouter();
  const [shipping, setShipping] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchShippings = async () => {
      try {
        const response = await fetch(`/api/shipping-companies/${params.id}`, {
          headers: {
            "x-internal-secret": process.env.NEXT_PUBLIC_INTERNAL_API_SECRET || "",
          },
        }); 
        console.log(response)
        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error || "Failed to fetch shipping companies");
        }
        const data = await response.json(); // parse JSON once
        setShipping(data);
      } catch (error: any) {
        console.error("Error fetching shippings:", error);
        toast.error(error.message || "Failed to load shipping companies data");
        router.push("/shipping-companies");
      } finally {
        setLoading(false);
      }
    };
    fetchShippings();
  }, [params.id, router]);

  return (
    <div className="container mx-auto py-6 space-y-6">
      <div className="flex items-center gap-2">
        <Link href="/shipping-companies">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Edit Shipping Companies</h1>
          <p className="text-muted-foreground">Update Shipping Companies information</p>
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
        <ShippingMethodForm methodData={shipping} isEditing={true} />
      )}
    </div>
  );
}
