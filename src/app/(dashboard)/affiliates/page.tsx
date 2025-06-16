/* /home/zodx/Desktop/Trapyfy/src/app/(dashboard)/affiliates/page.tsx */
import Link from "next/link";
import { Suspense } from "react";
import { Button } from "@/components/ui/button";
import { ClientsTable } from "../clients/clients-table";

export const metadata = {
  title: "Affiliates",
};

export default function AffiliatesDashboardPage() {
  return (
    <div className="container mx-auto py-6 px-6 space-y-6 px-3">
      {/* heading */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Affiliates</h1>
        <p className="text-muted-foreground">
          Manage client balances, levels and programme settings
        </p>
      </div>

      {/* top navigation */}
      <div className="flex flex-wrap gap-2 justify-end">
        <Link href="/affiliates/levels">
          <Button className="text-white bg-black" variant="secondary">Affiliate Levels</Button>
        </Link>
        <Link href="/affiliates/logs">
          <Button className="text-white bg-black" variant="secondary">Affiliate Logs</Button>
        </Link>
        <Link href="/affiliates/products">
          <Button className="text-white bg-black" variant="secondary">Affiliate Products</Button>
        </Link>
        <Link href="/affiliates/settings">
          <Button className="text-white bg-black" variant="secondary">Affiliate Settings</Button>
        </Link>
      </div>

      {/* clients table */}
      <Suspense fallback={<p className="text-sm">Loading clients…</p>}>
        <ClientsTable />
      </Suspense>
    </div>
  );
}
