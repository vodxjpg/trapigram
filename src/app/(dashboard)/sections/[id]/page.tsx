// src/app/(dashboard)/sections/[id]/page.tsx
"use client";

import { useRouter, useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SectionForm } from "../components/section-form";

export default function EditSectionPage() {
  const router = useRouter();
  const { id } = useParams<{ id: string }>();
  const [section, setSection] = useState<any>(null);
  const [sections, setSections] = useState([]);

  useEffect(() => {
    (async () => {
      const [s1, s2] = await Promise.all([
        fetch(`/api/sections/${id}`).then((r) => r.json()),
        fetch("/api/sections?depth=10").then((r) => r.json()),
      ]);
      setSection(s1.section);
      setSections(s2.sections);
    })();
  }, [id]);

  if (!section) return <p className="p-8">Loading…</p>;

  return (
    <div className="container mx-auto py-6 space-y-6">
      <Button variant="ghost" onClick={() => router.back()}>
        <ChevronLeft className="mr-2 h-4 w-4" />
        Back to Sections
      </Button>
      <SectionForm initial={section} sections={sections} />
    </div>
  );
}
