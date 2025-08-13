// src/app/(dashboard)/clients/[id]/page.tsx
"use client";

import { useEffect, useMemo }              from "react";
import { useParams, useRouter }            from "next/navigation";
import Link                                from "next/link";
import { ArrowLeft }                       from "lucide-react";

import { authClient }                      from "@/lib/auth-client";
import { useHasPermission }                from "@/hooks/use-has-permission";
import { Button }                          from "@/components/ui/button";
import ClientDetailView                    from "./client-form-read-only";

/* -------------------------------------------------------------------------- */

export default function ReadOnlyClientPage() {
  const { id }  = useParams<{ id: string }>();
  const router  = useRouter();

  /* active org → permission hook */
  const { data: activeOrg } = authClient.useActiveOrganization();
  const organizationId      = activeOrg?.id ?? null;

  const {
    hasPermission: viewPerm,
    isLoading:     viewLoading,
  } = useHasPermission(organizationId, { customer: ["view"] });

  const canView = useMemo(() => !viewLoading && viewPerm, [viewLoading, viewPerm]);

  /* redirect if not allowed */
  useEffect(() => {
    if (!viewLoading && !viewPerm) {
      router.replace("/clients");
    }
  }, [viewLoading, viewPerm, router]);

  if (viewLoading || !canView) return null;          // guard during resolve

  /* ---------------------------------------------------------------------- */
  return (
    <div className="container mx-auto py-6 px-6 space-y-6">
      <div className="flex items-center gap-2">
        <Link href="/clients">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Client</h1>
          <p className="text-muted-foreground">Client information</p>
          <div className="max-w-3xl mx-auto py-10">
            <Button variant="outline" onClick={() => router.back()}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to Ticket
            </Button>
          </div>
        </div>
      </div>

      {/* read-only client view – self-fetching */}
      <ClientDetailView clientId={id} />

   
    </div>
  );
}
