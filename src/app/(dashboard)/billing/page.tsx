"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useHeaderTitle } from "@/context/HeaderTitleContext";
import { authClient } from "@/lib/auth-client";
import { useHasPermission } from "@/hooks/use-has-permission";
import { InvoicesDataTable } from "./components/invoices-data-table";

export default function BillingPage() {
  const router = useRouter();
  const { setHeaderTitle } = useHeaderTitle();

  const { data: activeOrg } = authClient.useActiveOrganization();
  const orgId = activeOrg?.id ?? null;
  const { hasPermission: canView, isLoading: permLoading } =
    useHasPermission(orgId, { payment: ["view"] });

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  useEffect(() => {
    setHeaderTitle("Billing");
  }, [setHeaderTitle]);

  useEffect(() => {
    if (!permLoading && !canView) router.replace("/dashboard");
  }, [permLoading, canView, router]);

  if (permLoading || !canView) {
    return <p className="p-6">Loading…</p>;
  }

  return (
    <div className="p-6">
      <InvoicesDataTable
        page={page}
        pageSize={pageSize}
        onPageChange={setPage}
        onPageSizeChange={(n) => {
          setPageSize(n);
          setPage(1);
        }}
      />
    </div>
  );
}
