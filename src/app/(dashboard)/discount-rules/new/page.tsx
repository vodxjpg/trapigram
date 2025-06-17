// src/app/(dashboard)/discount-rules/new/page.tsx
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import { DiscountRuleForm } from "../components/discount-rules-form";

export default function NewDiscountRulePage() {
  return (
    <div className="container mx-auto py-6 px-6 space-y-6">
      <div className="flex items-center gap-2">
        <Link href="/discount-rules">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-3xl font-bold">New Tier price</h1>
          <p className="text-muted-foreground">Create a discount rule.</p>
        </div>
      </div>
      <DiscountRuleForm />
    </div>
  );
}
