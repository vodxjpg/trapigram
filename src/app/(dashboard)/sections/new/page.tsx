// src/app/(dashboard)/sections/new/page.tsx
"use client";

import { useEffect, useState }          from "react";
import { useRouter }                    from "next/navigation";
import { ChevronLeft }                  from "lucide-react";

import { Button }                       from "@/components/ui/button";
import { SectionForm }                  from "../components/section-form";

import { authClient }                   from "@/lib/auth-client";
import { useHasPermission }             from "@/hooks/use-has-permission";

/* -------------------------------------------------------------------------- */

export default function NewSectionPage() {
  const router = useRouter();

  /* active-org id for permission checks */
  const { data: activeOrg } = authClient.useActiveOrganization();
  const organizationId      = activeOrg?.id ?? null;

  /* permissions */
  const {
    hasPermission: canCreate,
    isLoading:     permLoading,
  } = useHasPermission(organizationId, { sections: ["create"] });

  /* sections list (for parent dropdown) */
  const [sections, setSections] = useState<any[]>([]);

  /* redirect if creation not allowed */
  useEffect(() => {
    if (!permLoading && !canCreate) {
      router.replace("/sections");
    }
  }, [permLoading, canCreate, router]);

  /* fetch sections once on mount */
  useEffect(() => {
    (async () => {
      try {
        const res  = await fetch("/api/sections?depth=10");
        const json = await res.json();
        setSections(json.sections);
      } catch {
        // ignore – form will handle empty list gracefully
      }
    })();
  }, []);

  /* guard */
  if (permLoading || !canCreate) return null;

  /* ---------------------------------------------------------------------- */
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
