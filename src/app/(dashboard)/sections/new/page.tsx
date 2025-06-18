// src/app/(dashboard)/sections/new/page.tsx
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SectionForm } from "../components/section-form";
import { usePermission } from "@/hooks/use-permission";

export default function NewSectionPage() {
  const router = useRouter();
  const can = usePermission();

  const canCreate = can({ sections: ["create"] });
  const [sections, setSections] = useState<any[]>([]);

  useEffect(() => {
    if (!can.loading && !canCreate) {
      router.replace("/sections");
    }
  }, [can.loading, canCreate, router]);

  useEffect(() => {
    (async () => {
      const res = await fetch("/api/sections?depth=10");
      const json = await res.json();
      setSections(json.sections);
    })();
  }, []);

  if (can.loading || !canCreate) return null;

  return (
    <div className="container mx-auto py-6 px-6 space-y-6">
      <Button variant="ghost" onClick={() => router.back()}>
        <ChevronLeft className="mr-2 h-4 w-4" />
        Back to Sections
      </Button>
      <SectionForm sections={sections} />
    </div>
  );
}
