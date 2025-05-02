// src/app/(dashboard)/affiliate-levels/page.tsx
import Link from "next/link";
import { ArrowLeft, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LevelsTable } from "./levels-table";

export const metadata = { title: "Affiliate Levels" };

export default function AffiliateLevelsPage() {
  return (
    <div className="container mx-auto py-6 space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/affiliates">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Affiliate Levels</h1>
          <p className="text-muted-foreground">
            Manage ranks and required points for your affiliates
          </p>
        </div>
        <div className="ml-auto">
          <Link href="/affiliate-levels/new">
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              Add Level
            </Button>
          </Link>
        </div>
      </div>

      <LevelsTable />
    </div>
  );
}
