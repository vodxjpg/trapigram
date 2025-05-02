/* /home/zodx/Desktop/trapigram/src/app/(dashboard)/affiliates/page.tsx */
import Link from "next/link";
import { Suspense } from "react";
import { Button } from "@/components/ui/button";
import { LogsTable } from "./logs-table";

export const metadata = {
  title: "Affiliate Logs",
};

export default function AffiliateLogsPage() {
  return (
    <div className="container mx-auto py-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Affiliate Logs</h1>
        <p className="text-muted-foreground">
          All point‑earning and adjustment events for your clients
        </p>
      </div>
      {/* ── new button ── */}
      <div className="text-right">
        <Link className="text-right" href="/affiliate-levels">
            <Button className="text-right" >Affiliate Levels</Button>
        </Link>
      </div>

      <Suspense fallback={<p className="text-sm">Loading logs…</p>}>
        {/* client component */}
        <LogsTable />
      </Suspense>
    </div>
  );
}
