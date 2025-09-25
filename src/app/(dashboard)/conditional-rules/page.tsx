import Link from "next/link";
import { Suspense } from "react";
import { Button } from "@/components/ui/button";
import RulesTable from "./components/RulesTable";

export default function RulesIndexPage() {
  return (
    <div className="p-4 md:p-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Conditional rules</h1>
          <p className="text-sm text-muted-foreground">
            Automate actions based on events and conditions.
          </p>
        </div>
        <Button asChild>
          <Link href="/conditional-rules/new">New rule</Link>
        </Button>
      </div>

      <div className="overflow-x-auto rounded-2xl border">
        <Suspense fallback={<div className="p-6">Loading…</div>}>
          <RulesTable />
        </Suspense>
      </div>
    </div>
  );
}
