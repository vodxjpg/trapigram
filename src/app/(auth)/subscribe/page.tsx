'use client';

import { useEffect } from "react";
import { authClient } from "@/lib/auth-client";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import Pricing from "@/components/Pricing/Pricing";
import { IconLogout } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";

interface SessionResponse {
  data?: {
    session: { userId: string };
    user: { id: string; name: string; email: string };
  };
  error?: { message: string };
}

export default function SubscribePage() {
  const router = useRouter();

  // redirect if already subscribed
  useEffect(() => {
    (async () => {
      try {
        const resp = (await authClient.getSession()) as SessionResponse;
        if (resp.error || !resp.data) {
          toast.error("You must be logged in to select a plan");
          return router.push("/login");
        }
        const { user } = resp.data;
        const { data, error } = await authClient.subscription.status(undefined, {
          query: { userId: user.id },
        });
        if (error) {
          toast.error(error.message);
        } else if (data.hasActiveSubscription) {
          toast.success("You already have an active subscription");
          router.push("/dashboard");
        }
      } catch {
        toast.error("Failed to check subscription status");
      }
    })();
  }, [router]);

  async function handleSelectTier(plan: string) {
    try {
      // ensure logged in
      const resp = (await authClient.getSession()) as SessionResponse;
      if (resp.error || !resp.data) {
        toast.error("You must be logged in to select a plan");
        return router.push("/login");
      }
      const userId = resp.data.user.id;

      // create Clerk subscription
      const { error: subError } = await authClient.subscription.create({
        userId,
        plan,
      });
      if (subError) {
        toast.error(subError.message || "Failed to select plan");
        return;
      }

      // call our tenant endpoint
      const tenantRes = await fetch("/api/internal/tenant", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan }),
        redirect: "follow", // default, follow redirects
      });

      // if the API redirected us to /onboarding, next/router will know
      if (tenantRes.redirected) {
        return router.push(tenantRes.url.replace(window.location.origin, ""));
      }

      // otherwise expect JSON
      const body = await tenantRes.json();
      if (!tenantRes.ok) {
        toast.error(body.error || "Failed to create tenant");
        return;
      }

      // fallback: tenant created but no redirect?
      toast.success("Plan selected and tenant created!");
      router.push("/dashboard");
    } catch (err) {
      console.error(err);
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
      <h1 className="text-3xl font-bold mb-6">
        Choose Your Subscription Plan
      </h1>
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
