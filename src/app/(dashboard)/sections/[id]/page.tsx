// src/app/(dashboard)/sections/[id]/page.tsx
"use client";

import { useEffect, useState }          from "react";
import { useRouter, useParams }         from "next/navigation";
import { ChevronLeft }                  from "lucide-react";

import { Button }                       from "@/components/ui/button";
import { SectionForm }                  from "../components/section-form";

import { authClient }                   from "@/lib/auth-client";
import { useHasPermission }             from "@/hooks/use-has-permission";

/* -------------------------------------------------------------------------- */

export default function EditSectionPage() {
  const router = useRouter();
  const { id } = useParams<{ id: string }>();

  /* active-org id for permission checks */
  const { data: activeOrg } = authClient.useActiveOrganization();
  const organizationId      = activeOrg?.id ?? null;

  /* permissions */
  const {
    hasPermission: canUpdate,
    isLoading:     permLoading,
  } = useHasPermission(organizationId, { sections: ["update"] });

  /* section state */
  const [section,  setSection ] = useState<any>(null);
  const [sections, setSections] = useState<any[]>([]);

  /* redirect if no update permission */
  useEffect(() => {
    if (!permLoading && !canUpdate) {
      router.replace("/sections");
    }
  }, [permLoading, canUpdate, router]);

  /* fetch section + list once allowed */
  useEffect(() => {
    if (!canUpdate) return;
    (async () => {
      const [sRes, listRes] = await Promise.all([
        fetch(`/api/sections/${id}`),
        fetch("/api/sections?depth=10"),
      ]);
      const sJson    = await sRes.json();
      const listJson = await listRes.json();
      setSection(sJson.section);
      setSections(listJson.sections);
    })();
  }, [id, canUpdate]);

  /* guard */
  if (permLoading || !canUpdate) return null;
  if (!section) return <p className="p-8">Loading…</p>;

  /* ---------------------------------------------------------------------- */
  return (
    <div className="container mx-auto py-6 px-6 space-y-6">
      <Button variant="ghost" onClick={() => router.back()}>
        <ChevronLeft className="mr-2 h-4 w-4" />
        Back to Sections
      </Button>

      <SectionForm initial={section} sections={sections} />
    </div>
  );
}
