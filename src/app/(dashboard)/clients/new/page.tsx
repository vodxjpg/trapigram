// src/app/(dashboard)/clients/new/page.tsx   ← keep original path
"use client";

import { useEffect, useMemo }             from "react";
import { useRouter }                      from "next/navigation";
import Link                               from "next/link";
import { ArrowLeft }                      from "lucide-react";

import { authClient }                     from "@/lib/auth-client";
import { useHasPermission }               from "@/hooks/use-has-permission";  // ← NEW
import { ClientForm }                     from "../client-form";
import { Button }                         from "@/components/ui/button";

/* -------------------------------------------------------------------------- */

export default function NewClientPage() {
  const router = useRouter();

  /* active organisation ⟶ permission hook */
  const { data: activeOrg } = authClient.useActiveOrganization();
  const organizationId      = activeOrg?.id ?? null;

  const {
    hasPermission,
    isLoading,
  } = useHasPermission(organizationId, { customer: ["create"] });

  /* ✨ compatibility wrapper so existing code (`can.loading`, `can({…})`) keeps working */
  const can = useMemo(() => {
    const fn = (_p: any) => hasPermission; // we already asked for create
    (fn as any).loading = isLoading;
    return fn as typeof fn & { loading: boolean };
  }, [hasPermission, isLoading]);

  /* redirect only *after* permission resolved */
  useEffect(() => {
    if (!can.loading && !can({ customer: ["create"] })) {
      router.replace("/clients");
    }
  }, [can, router]);

  if (can.loading || !can({ customer: ["create"] })) return null;

  return (
    <div className="container mx-auto py-6 px-6 space-y-6">
      <div className="flex items-center gap-2">
        <Link href="/clients">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Add New Client</h1>
          <p className="text-muted-foreground">
            Create a new client in your database
          </p>
        </div>
      </div>
      <ClientForm />
    </div>
  );
}
