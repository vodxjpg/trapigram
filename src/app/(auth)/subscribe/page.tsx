'use client';

import { useEffect } from "react";
import { authClient } from "@/lib/auth-client";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import Pricing from "@/components/Pricing/Pricing";
import { IconLogout } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";

type SessionPayload = {
  user: { id: string; name: string; email: string };
  session: { userId: string };
};

type GetSessionOk = { data: SessionPayload | null };
type GetSessionErr = { error: { code?: string; message?: string } };
type GetSessionResult = GetSessionOk | GetSessionErr;

function isError(res: GetSessionResult): res is GetSessionErr {
  return "error" in res && !!res.error;
}

function hasData(res: GetSessionResult): res is GetSessionOk {
  return "data" in res;
}

export default function SubscribePage() {
  const router = useRouter();

  useEffect(() => {
    (async () => {
      try {
        const res = (await authClient.getSession()) as GetSessionResult;

        if (isError(res) || !hasData(res) || !res.data) {
          toast.error("You must be logged in to select a plan");
          router.push("/login");
          return;
        }

        const { user } = res.data;
        const { data, error } = await authClient.subscription.status(undefined, {
          query: { userId: user.id },
        });

        if (error) {
          toast.error(error.message);
        } else if (data?.hasActiveSubscription) {
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
      const res = (await authClient.getSession()) as GetSessionResult;

      if (isError(res) || !hasData(res) || !res.data) {
        toast.error("You must be logged in to select a plan");
        router.push("/login");
        return;
      }

      const userId = res.data.user.id;

      // create Clerk subscription
      const { error: subError } = await authClient.subscription.create({
        userId,
        plan,
      });
      if (subError) {
        toast.error(subError.message || "Failed to select plan");
        return;
      }

      // create tenant
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

      const body = await tenantRes.json();
      if (!tenantRes.ok) {
        toast.error(body.error || "Failed to create tenant");
        return;
      }

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
