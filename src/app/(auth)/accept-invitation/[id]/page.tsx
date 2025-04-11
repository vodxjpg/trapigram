// /home/zodx/Desktop/trapigram/src/app/(auth)/accept-invitation/[id]/page.tsx
"use client";

import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { toast } from "sonner";

export default function AcceptInvitation() {
  const router = useRouter();
  const params = useParams();
  const invitationId = params.id as string;
  const [status, setStatus] = useState<"loading" | "done" | "error">("loading");

  useEffect(() => {
    const handleInvitation = async () => {
      try {
        const response = await fetch(`/api/organizations/accept-invitation/${invitationId}`, {
          method: "GET",
          credentials: "include",
        });
        const data = await response.json();
        console.log("API response:", data);

        if (!response.ok) {
          throw new Error(data.error || "Failed to process invitation");
        }

        toast.success("Invitation processed");
        setStatus("done");
        router.push(data.redirect);
      } catch (error) {
        console.error("Error:", error);
        toast.error(error.message);
        setStatus("error");
        router.push("/login");
      }
    };

    if (invitationId) handleInvitation();
  }, [invitationId, router]);

  if (status === "loading") {
    return <div className="flex min-h-screen items-center justify-center">Processing invitation...</div>;
  }
  if (status === "done") {
    return <div className="flex min-h-screen items-center justify-center">Redirecting...</div>;
  }
  return <div className="flex min-h-screen items-center justify-center">Something went wrong...</div>;
}