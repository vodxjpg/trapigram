// src/app/(dashboard)/affiliates/levels/new/page.client.tsx
"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { LevelForm } from "../level-form";
import { usePermission } from "@/hooks/use-permission";

export function ClientNewLevelPage() {
  const router = useRouter();
  const can = usePermission();

  useEffect(() => {
    if (!can.loading && !can({ affiliates: ["settings"] })) {
      router.replace("/affiliates");
    }
  }, [can, router]);

  if (can.loading) return null;
  if (!can({ affiliates: ["settings"] })) return null;

  return (
    <div className="container mx-auto py-6">
      <LevelForm />
    </div>
  );
}
