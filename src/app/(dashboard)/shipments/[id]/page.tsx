// src/app/(dashboard)/shipments/[id]/edit/page.tsx
"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { useHasPermission } from "@/hooks/use-has-permission";
import { ShipmentForm } from "../components/shipment-form";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { Skeleton } from "@/components/ui/skeleton";

export default function EditShipmentPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();

  /* ── active organisation ───────────────────────────────────────── */
  const { data: activeOrg } = authClient.useActiveOrganization();
  const organizationId = activeOrg?.id ?? null;

  /* ── permission for updating shipping methods ──────────────────── */
  const {
    hasPermission: canUpdate,
    isLoading: permLoading,
  } = useHasPermission(organizationId, { shipping: ["update"] });

  const [shipment, setShipment] = useState<any>(null);
  const [loadingData, setLoadingData] = useState(true);

  // redirect if they can't update
  useEffect(() => {
    if (!permLoading && !canUpdate) {
      router.replace("/shipments");
    }
  }, [permLoading, canUpdate, router]);

  // fetch shipment data once permissions are known
  useEffect(() => {
    if (permLoading) return;
    if (!canUpdate) return;

    (async () => {
      try {
        const response = await fetch(`/api/shipments/${params.id}`, {
          headers: {
            "x-internal-secret": process.env.NEXT_PUBLIC_INTERNAL_API_SECRET || "",
          },
        });
        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error || "Failed to fetch shipment");
        }
        const data = await response.json();
        setShipment(data);
      } catch (error: any) {
        console.error("Error fetching shipment:", error);
        toast.error(error.message || "Failed to load shipment data");
        router.push("/shipments");
      } finally {
        setLoadingData(false);
      }
    })();
  }, [permLoading, canUpdate, params.id, router]);

  // show skeleton while checking permissions or loading data
  if (permLoading || loadingData) {
    return (
      <div className="container mx-auto py-6 px-6 space-y-6">
        <Skeleton className="h-12 w-full" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[...Array(6)].map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
        <Skeleton className="h-10 w-32 mx-auto" />
      </div>
    );
  }

  return (
    <div className="container mx-auto py-6 px-6 space-y-6">
      <div className="flex items-center gap-2">
        <Link href="/shipments">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Edit shipment</h1>
          <p className="text-muted-foreground">Update shipment information</p>
        </div>
      </div>
      <ShipmentForm shipmentData={shipment} isEditing={true} />
    </div>
  );
}
