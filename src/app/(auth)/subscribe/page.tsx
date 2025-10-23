'use client';

import { useEffect } from "react";
import { authClient } from "@/lib/auth-client";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import Pricing from "@/components/Pricing/Pricing";
import { IconLogout } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";

type SessionData = {
  session?: { userId: string };
  user?: { id: string; name: string; email: string };
};

export default function SubscribePage() {
  const router = useRouter();

  // redirect if already subscribed (best-effort: uses SDK if it’s available)
  useEffect(() => {
    (async () => {
      try {
        const res = await authClient.getSession();
        const data = (res as any)?.data as SessionData | undefined;
        const err  = (res as any)?.error as { message?: string } | undefined;

        if (err || !data?.user) {
          toast.error("You must be logged in to select a plan");
          router.push("/login");
          return;
        }

        const subClient = (authClient as any).subscription;
        if (subClient?.status) {
          const { data: subData, error: subError } = await subClient.status(undefined, {
            query: { userId: data.user.id },
          });
          if (subError) {
            toast.error(subError.message);
          } else if (subData?.hasActiveSubscription) {
            toast.success("You already have an active subscription");
            router.push("/dashboard");
          }
        }
        // If no subscription client, skip the pre-check; server will guard later.
      } catch {
        // Non-fatal; keep user on page to choose a plan
      }
    })();
  }, [router]);

  async function handleSelectTier(plan: string) {
    try {
      // ensure logged in
      const res = await authClient.getSession();
      const data = (res as any)?.data as SessionData | undefined;
      const err  = (res as any)?.error as { message?: string } | undefined;

      if (err || !data?.user?.id) {
        toast.error("You must be logged in to select a plan");
        router.push("/login");
        return;
      }
      const userId = data.user.id;

      // Try SDK subscription.create if available; otherwise let our API do it.
      const subClient = (authClient as any).subscription;
      if (subClient?.create) {
        const { error: subError } = await subClient.create({ userId, plan });
        if (subError) {
          toast.error(subError.message || "Failed to select plan");
          return;
        }
      }

      // Create tenant (and/or complete subscription) on our backend
      const tenantRes = await fetch("/api/internal/tenant", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan }),
        redirect: "follow",
      });

      if (tenantRes.redirected) {
        router.push(tenantRes.url.replace(window.location.origin, ""));
        return;
      }

      const body = await tenantRes.json().catch(() => ({}));
      if (!tenantRes.ok) {
        toast.error(body?.error || "Failed to create tenant");
        return;
      }

      toast.success("Plan selected and tenant created!");
      router.push("/dashboard");
    } catch {
      toast.error("An unexpected error occurred");
    }
  }

  async function handleLogout() {
    try {
      await authClient.signOut();
      toast.success("Logged out successfully!");
      router.push("/login");
    } catch {
      toast.error("Failed to log out.");
    }
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-screen p-4">
      <h1 className="text-3xl font-bold mb-6">Choose Your Subscription Plan</h1>
      <Pricing onSelectTier={handleSelectTier} />
      <div className="mt-5">
        <Button variant="link" onClick={handleLogout}>
          <IconLogout className="mr-2 h-4 w-4" />
          Log out
        </Button>
      </div>
    </div>
  );
}
