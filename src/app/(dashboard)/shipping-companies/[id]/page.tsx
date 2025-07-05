"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { usePermission } from "@/hooks/use-permission";
import { ShippingMethodForm } from "../shipping-companies-form";

export default function EditShippingMethodPage() {
  const { id } = useParams();
  const router = useRouter();
   const can = usePermission(); ;

  const [method, setMethod] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  // 1) Redirect if no update permission// src/app/(dashboard)/shipping-companies/[id]/page.tsx
"use client";

import { useState, useEffect } from "react";
import { useRouter, useParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";
import { useHasPermission } from "@/hooks/use-has-permission";
import { ShippingMethodForm } from "../shipping-companies-form";

export default function EditShippingMethodPage() {
  const router = useRouter();
  const { id } = useParams() as { id: string };

  // ── active organization → id for permission hook ─────────────────────────
  const { data: activeOrg } = authClient.useActiveOrganization();
  const orgId = activeOrg?.id ?? null;

  // ── secure permission check for updating shippingMethods ─────────────────
  const {
    hasPermission: canUpdate,
    isLoading: updateLoading,
  } = useHasPermission(orgId, { shippingMethods: ["update"] });

  // ── redirect if no update permission ─────────────────────────────────────
  useEffect(() => {
    if (!updateLoading && !canUpdate) {
      router.replace("/shipping-companies");
    }
  }, [updateLoading, canUpdate, router]);

  // ── local state for method data ──────────────────────────────────────────
  const [method, setMethod] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  // ── fetch the method once we know we have update access ───────────────────
  useEffect(() => {
    if (updateLoading || !canUpdate) return;

    setLoading(true);
    (async () => {
      try {
        const res = await fetch(`/api/shipping-companies/${id}`, {
          headers: {
            "x-internal-secret": process.env.NEXT_PUBLIC_INTERNAL_API_SECRET || "",
          },
        });
        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error || "Failed to fetch shipping method");
        }
        const data = await res.json();
        setMethod(data);
      } catch (error: any) {
        console.error("Error fetching shipping method:", error);
        toast.error(error.message || "Failed to load data");
        router.replace("/shipping-companies");
      } finally {
        setLoading(false);
      }
    })();
  }, [id, updateLoading, canUpdate, router]);

  // ── guard while loading permissions or lacking update access ─────────────
  if (updateLoading || !canUpdate) {
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
          <h1 className="text-3xl font-bold tracking-tight">Edit Shipping Method</h1>
          <p className="text-muted-foreground">Update shipping method information</p>
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
        <ShippingMethodForm methodData={method} isEditing />
      )}
    </div>
  );
}

  useEffect(() => {
    if (!can.loading && !can({ shippingMethods: ["update"] })) {
      router.replace("/shipping-companies");
    }
  }, [can, router]);

  // 2) Fetch the method once we know we have access
  useEffect(() => {
    if (can.loading || !can({ shippingMethods: ["update"] })) return;

    (async () => {
      try {
        const res = await fetch(`/api/shipping-companies/${id}`, {
          headers: {
            "x-internal-secret": process.env.NEXT_PUBLIC_INTERNAL_API_SECRET ?? "",
          },
        });
        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error || "Failed to fetch shipping method");
        }
        setMethod(await res.json());
      } catch (error: any) {
        console.error("Error fetching shipping method:", error);
        toast.error(error.message || "Failed to load data");
        router.replace("/shipping-companies");
      } finally {
        setLoading(false);
      }
    })();
  }, [id, can, router]);

  // 3) Avoid rendering until we know permission & load state
  if (can.loading || !can({ shippingMethods: ["update"] })) {
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
          <h1 className="text-3xl font-bold tracking-tight">Edit Shipping Method</h1>
          <p className="text-muted-foreground">Update shipping method information</p>
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
        <ShippingMethodForm methodData={method} isEditing />
      )}
    </div>
  );
}
