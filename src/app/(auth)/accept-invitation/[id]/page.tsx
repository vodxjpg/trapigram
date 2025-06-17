// /home/zodx/Desktop/Trapyfy/src/app/(auth)/accept-invitation/[id]/page.tsx
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
    async function handleInvitation() {
      try {
        const res = await fetch(`/api/organizations/accept-invitation/${invitationId}`, {
          method: "GET",
          credentials: "include",
        });
        const data = await res.json();
        console.log("Accept Invitation API response:", data);

        if (!res.ok) {
          throw new Error(data.error || "Failed to process invitation");
        }

        // success => redirect
        toast.success("Invitation processed successfully!");
        setStatus("done");
        router.push(data.redirect); // e.g. /login, /set-password, /dashboard, etc.
      } catch (error: any) {
        console.error("Error accepting invitation:", error);
        toast.error(error.message || "Failed to accept invitation");
        setStatus("error");
        // Possibly push to /login if needed
        router.push("/login");
      }
    }

    if (invitationId) {
      handleInvitation();
    }
  }, [invitationId, router]);

  if (status === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center">
        Processing invitation...
      </div>
    );
  }
  if (status === "done") {
    return (
      <div className="flex min-h-screen items-center justify-center">
        Redirecting...
      </div>
    );
  }
  return (
    <div className="flex min-h-screen items-center justify-center">
      Something went wrong...
    </div>
  );
}
