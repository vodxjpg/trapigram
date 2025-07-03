// src/app/(dashboard)/shipments/new/page.tsx
"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { useHasPermission } from "@/hooks/use-has-permission";
import { ShipmentForm } from "../shipment-form";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

export default function NewShipmentPage() {
  const router = useRouter();

  /* ── active organisation ───────────────────────────────────────── */
  const { data: activeOrg } = authClient.useActiveOrganization();
  const organizationId = activeOrg?.id ?? null;

  /* ── permission for creating shipping methods ───────────────────── */
  const {
    hasPermission: canCreate,
    isLoading:     permLoading,
  } = useHasPermission(organizationId, { shipping: ["create"] });

  // redirect if they can't create
  useEffect(() => {
    if (!permLoading && !canCreate) {
      router.replace("/shipments");
    }
  }, [permLoading, canCreate, router]);

  // wait for permission check
  if (permLoading || !canCreate) return null;

  return (
    <div className="container mx-auto py-6 px-6 space-y-6">
      <div className="flex items-center gap-2">
        <Link href="/shipments">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-3xl font-bold tracking-tight">
            Add New Shippping method
          </h1>
          <p className="text-muted-foreground">
            Create a new shipping method
          </p>
        </div>
      </div>
      <ShipmentForm />
    </div>
  );
}
