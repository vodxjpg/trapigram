// src/app/(dashboard)/sections/new/page.tsx
"use client";

import { useRouter } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SectionForm } from "../components/section-form";
import { useEffect, useState } from "react";

export default function NewSectionPage() {
  const router = useRouter();
  const [sections, setSections] = useState([]);

  useEffect(() => {
    (async () => {
      const res = await fetch("/api/sections?depth=10");
      const { sections } = await res.json();
      setSections(sections);
    })();
  }, []);

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
