// src/app/(dashboard)/announcements/[id]/page.tsx
"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { AnnouncementForm } from "../announcements-form";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { Skeleton } from "@/components/ui/skeleton";
import { usePermission } from "@/hooks/use-permission";

export default function EditAnnouncementPage() {
  const params = useParams();
  const router = useRouter();
   const can = usePermission(); ;

  const canUpdate = can({ announcements: ["update"] });

  const [announcement, setAnnouncement] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  // redirect if no update perms
  useEffect(() => {
    if (!can.loading && !canUpdate) {
      router.replace("/announcements");
    }
  }, [can.loading, canUpdate, router]);

  useEffect(() => {
    if (!canUpdate) return;
    const fetchAnnouncement = async () => {
      try {
        const res = await fetch(`/api/announcements/${params.id}`, {
          headers: {
            "x-internal-secret": process.env.NEXT_PUBLIC_INTERNAL_API_SECRET || "",
          },
        });
        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error || "Failed to fetch announcement");
        }
        const data = await res.json();
        setAnnouncement({ ...data, deliveryScheduled: !!data.deliveryDate });
      } catch (error: any) {
        console.error("Error fetching announcement:", error);
        toast.error(error.message || "Failed to load announcement");
        router.push("/announcements");
      } finally {
        setLoading(false);
      }
    };
    fetchAnnouncement();
  }, [canUpdate, params.id, router]);

  if (can.loading || !canUpdate) return null;

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
