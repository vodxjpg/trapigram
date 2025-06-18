// src/app/(dashboard)/clients/[id]/page.tsx
"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { ClientForm } from "../client-form";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { Skeleton } from "@/components/ui/skeleton";
import { usePermission } from "@/hooks/use-permission";

export default function EditClientPage() {
  const params = useParams();
  const router = useRouter();
  const can = usePermission();

  const [client, setClient] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  // 1) Redirect away if they lack the update permission
  useEffect(() => {
    if (!can.loading && !can({ customer: ["update"] })) {
      router.replace("/clients");
    }
  }, [can, router]);

  // 2) Do not render until permissions are known
  if (can.loading || !can({ customer: ["update"] })) {
    return null;
  }

  // 3) Fetch client data
  useEffect(() => {
    const fetchClient = async () => {
      try {
        const response = await fetch(`/api/clients/${params.id}`, {
          headers: {
            "x-internal-secret":
              process.env.NEXT_PUBLIC_INTERNAL_API_SECRET || "",
          },
        });
        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error || "Failed to fetch client");
        }
        const data = await response.json();
        setClient(data);
      } catch (error: any) {
        console.error("Error fetching client:", error);
        toast.error(error.message || "Failed to load client data");
        router.push("/clients");
      } finally {
        setLoading(false);
      }
    };
    fetchClient();
  }, [params.id, router]);

  return (
    <div className="container mx-auto py-6 px-6 space-y-6">
      {/* Back button + header */}
      <div className="flex items-center gap-2">
        <Link href="/clients">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Edit Client</h1>
          <p className="text-muted-foreground">
            Update client information
          </p>
        </div>
      </div>

      {/* Form or skeleton */}
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
        <ClientForm clientData={client} isEditing={true} />
      )}

      {/* Client statistics */}
      {!loading && (
        <div className="mt-8">
          <h2 className="text-xl font-semibold mb-4">Client Statistics</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="border rounded-lg p-4">
              <h3 className="text-sm font-medium text-muted-foreground">
                Total Orders
              </h3>
              <p className="text-2xl font-bold">0</p>
            </div>
            <div className="border rounded-lg p-4">
              <h3 className="text-sm font-medium text-muted-foreground">
                Most Purchased Product
              </h3>
              <p className="text-lg font-medium">None yet</p>
            </div>
            <div className="border rounded-lg p-4">
              <h3 className="text-sm font-medium text-muted-foreground">
                Last Purchase
              </h3>
              <p className="text-lg font-medium">Never</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
