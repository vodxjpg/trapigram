// src/app/(dashboard)/announcements/[id]/page.tsx
"use client";

import { useState, useEffect }         from "react";
import { useParams, useRouter }        from "next/navigation";
import Link                            from "next/link";
import { ArrowLeft }                   from "lucide-react";
import { toast }                       from "sonner";

import { AnnouncementForm }            from "../announcements-form";
import { Button }                      from "@/components/ui/button";
import { Skeleton }                    from "@/components/ui/skeleton";

import { authClient }                  from "@/lib/auth-client";
import { useHasPermission }            from "@/hooks/use-has-permission";

/* -------------------------------------------------------------------------- */

export default function EditAnnouncementPage() {
  const params  = useParams<{ id: string }>();
  const router  = useRouter();

  /* active-org → id for permission hook */
  const { data: activeOrg } = authClient.useActiveOrganization();
  const organizationId      = activeOrg?.id ?? null;

  const {
    hasPermission: canUpdate,
    isLoading:     permLoading,
  } = useHasPermission(organizationId, { announcements: ["update"] });

  /* local state */
  const [announcement, setAnnouncement] = useState<any>(null);
  const [loading, setLoading]           = useState(true);

  /* redirect if forbidden */
  useEffect(() => {
    if (!permLoading && !canUpdate) {
      router.replace("/announcements");
    }
  }, [permLoading, canUpdate, router]);

  /* fetch data once permitted */
  useEffect(() => {
    if (permLoading || !canUpdate) return;

    (async () => {
      try {
        const res = await fetch(`/api/announcements/${params.id}`, {
          headers: {
            "x-internal-secret":
              process.env.NEXT_PUBLIC_INTERNAL_API_SECRET || "",
          },
        });
        if (!res.ok) {
          const { error } = await res.json().catch(() => ({}));
          throw new Error(error || "Failed to fetch announcement");
        }
        const data = await res.json();
        setAnnouncement({ ...data, deliveryScheduled: !!data.deliveryDate });
      } catch (err: any) {
        console.error("Error fetching announcement:", err);
        toast.error(err.message || "Failed to load announcement");
        router.push("/announcements");
      } finally {
        setLoading(false);
      }
    })();
  }, [permLoading, canUpdate, params.id, router]);

  /* guards */
  if (permLoading || !canUpdate) return null;

  /* ---------------------------------------------------------------------- */
  return (
    <div className="container mx-auto py-6 px-6 space-y-6">
      <div className="flex items-center gap-2">
        <Link href="/announcements">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Edit Announcement</h1>
          <p className="text-muted-foreground">Update announcement information</p>
        </div>
      </div>

      {loading ? (
        <div className="space-y-4">
          <Skeleton className="h-12 w-full" />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {[...Array(6)].map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
          <Skeleton className="h-10 w-32 mx-auto" />
        </div>
      ) : (
        <AnnouncementForm announcementData={announcement} isEditing={true} />
      )}
    </div>
  );
}
