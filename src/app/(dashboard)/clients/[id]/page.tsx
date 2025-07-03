// src/app/(dashboard)/clients/[id]/page.tsx
"use client";

import { useState, useEffect, useMemo }  from "react";
import { useParams, useRouter }          from "next/navigation";
import Link                              from "next/link";
import { ArrowLeft }                     from "lucide-react";
import { toast }                         from "sonner";

import { authClient }                    from "@/lib/auth-client";         // ← NEW
import { useHasPermission }              from "@/hooks/use-has-permission";// ← NEW
import { ClientForm }                    from "../client-form";
import { Button }                        from "@/components/ui/button";
import { Skeleton }                      from "@/components/ui/skeleton";

/* -------------------------------------------------------------------------- */

export default function EditClientPage() {
  const params  = useParams<{ id: string }>();
  const router  = useRouter();

  /* active organisation ⟶ id for permission hook */
  const { data: activeOrg } = authClient.useActiveOrganization();
  const organizationId      = activeOrg?.id ?? null;

  /* secure permission check */
  const {
    hasPermission: updatePerm,
    isLoading:     updateLoading,
  } = useHasPermission(organizationId, { customer: ["update"] });

  /* adapter so existing code (`can.loading`, `can({…})`) keeps working */
  const can = useMemo(() => {
    const fn = (_p: any) => updatePerm; // we already queried for "update"
    (fn as any).loading = updateLoading;
    return fn as typeof fn & { loading: boolean };
  }, [updatePerm, updateLoading]);

  /* client data state */
  const [client, setClient]   = useState<any>(null);
  const [loading, setLoading] = useState(true);

  /* redirect if lacking permission */
  useEffect(() => {
    if (!can.loading && !can({ customer: ["update"] })) {
      router.replace("/clients");
    }
  }, [can, router]);

  /* fetch client once permission resolved */
  useEffect(() => {
    if (can.loading || !can({ customer: ["update"] })) return;

    const fetchClient = async () => {
      try {
        const response = await fetch(`/api/clients/${params.id}`, {
          headers: {
            "x-internal-secret":
              process.env.NEXT_PUBLIC_INTERNAL_API_SECRET || "",
          },
        });
        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.error || "Failed to fetch client");
        }
        const data = await response.json();
        setClient(data.client);
      } catch (error: any) {
        console.error("Error fetching client:", error);
        toast.error(error.message || "Failed to load client data");
        router.push("/clients");
      } finally {
        setLoading(false);
      }
    };

    fetchClient();
  }, [can.loading, can, params.id, router]);

  /* guard during permission resolve */
  if (can.loading || !can({ customer: ["update"] })) return null;

  /* ---------------------------------------------------------------------- */
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
          <p className="text-muted-foreground">Update client information</p>
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
    </div>
  );
}
