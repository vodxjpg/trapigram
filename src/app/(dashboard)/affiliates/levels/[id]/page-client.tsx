// src/app/(dashboard)/affiliates/levels/[id]/page.client.tsx
"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { LevelForm } from "../level-form";
import { usePermission } from "@/hooks/use-permission";

interface Props { id: string }

export function ClientEditLevelPage({ id }: Props) {
  const router = useRouter();
  const can = usePermission(organizationId);;

  // Redirect away if they lack the affiliate‐settings permission
  useEffect(() => {
    if (!can.loading && !can({ affiliates: ["settings"] })) {
      router.replace("/affiliates");
    }
  }, [can, router]);

  if (can.loading) return null;
  if (!can({ affiliates: ["settings"] })) return null;

  return (
    <div className="container mx-auto py-6">
      <LevelForm id={id} />
    </div>
  );
}
