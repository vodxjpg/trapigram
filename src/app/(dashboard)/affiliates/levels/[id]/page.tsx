// src/app/(dashboard)/affiliates/levels/[id]/page.tsx
"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { LevelForm } from "../level-form";
import { usePermission } from "@/hooks/use-permission";

export const metadata = { title: "Edit Affiliate Level" };

export default function EditLevelPage({ params }: { params: { id: string } }) {
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
      <LevelForm id={params.id} />
    </div>
  );
}
