// src/app/(dashboard)/discount-rules/[id]/page.tsx
"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { Skeleton } from "@/components/ui/skeleton";
import { DiscountRuleForm } from "../components/discount-rules-form";

export default function EditDiscountRulePage() {
  const { id } = useParams();
  const router = useRouter();
  const [rule, setRule] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/tier-pricing/${id}`)
      .then((res) => {
        if (!res.ok) throw new Error("Failed to fetch");
        return res.json();
      })
      .then(setRule)
      .catch((e) => {
        toast.error(e.message);
        router.push("/discount-rules");
      })
      .finally(() => setLoading(false));
  }, [id, router]);

  return (
    <div className="container mx-auto py-6 space-y-6">
      <div className="flex items-center gap-2">
        <Link href="/discount-rules">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-3xl font-bold">Edit Discount Rule</h1>
          <p className="text-muted-foreground">Update your rule.</p>
        </div>
      </div>
      {loading ? (
        <div className="space-y-4">
          <Skeleton className="h-12 w-full" />
          {[...Array(3)].map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : (
        <DiscountRuleForm discountRuleData={rule} isEditing />
      )}
    </div>
  );
}
