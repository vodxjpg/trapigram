// /home/zodx/Desktop/trapigram/src/app/(dashboard)/accept-invitation/[invitationId]/page.tsx
"use client";

import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { toast } from "sonner";
import { authClient } from "@/lib/auth-client";

export default function AcceptInvitationPage() {
  const router = useRouter();
  const params = useParams();
  const invitationId = params.invitationId as string;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const acceptInvitation = async () => {
      try {
        const { data, error } = await authClient.organization.acceptInvitation({ invitationId });
        if (error) throw new Error(error.message);
        toast.success("Invitation accepted successfully");
        router.push(`/organizations/${data.organization.slug}`);
      } catch (err: any) {
        console.error("Error accepting invitation:", err);
        setError("Failed to accept invitation. It may be invalid or expired.");
      } finally {
        setLoading(false);
      }
    };

    if (invitationId) acceptInvitation();
  }, [invitationId, router]);

  if (loading) {
    return <div className="flex items-center justify-center h-full">Accepting invitation...</div>;
  }

  if (error) {
    return <div className="flex items-center justify-center h-full text-red-500">{error}</div>;
  }

  return null; // Redirects on success
}