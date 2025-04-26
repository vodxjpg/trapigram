// /home/zodx/Desktop/trapigram/src/app/(auth)/subscribe/page.tsx
"use client";

import { useEffect } from "react";
import { authClient } from "@/lib/auth-client";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import Pricing from "@/components/Pricing/Pricing";
import { plans } from "@/data/plans";
import { Button } from "@/components/ui/button";

interface SessionResponse {
  data?: {
    session: {
      id: string;
      token: string;
      expiresAt: Date;
      createdAt: Date;
      updatedAt: Date;
      ipAddress: string;
      userAgent: string;
      userId: string;
    };
    user: {
      id: string;
      name: string;
      email: string;
      emailVerified: boolean;
      image: string | null;
      createdAt: Date;
      updatedAt: Date;
      phone: string;
      country: string;
      is_guest: boolean;
    };
  };
  error?: {
    message: string;
    status?: number;
  };
}

export default function SubscribePage() {
  const router = useRouter();

  useEffect(() => {
    const checkSubscription = async () => {
      try {
        const response = (await authClient.getSession()) as SessionResponse;
        console.log("Session in subscribe page:", response);

        if (response.error || !response.data) {
          console.log("No valid session data, redirecting to /login");
          toast.error("You must be logged in to select a plan");
          router.push("/login");
          return;
        }

        const { user } = response.data;
        if (!user) {
          console.log("No user in session data, redirecting to /login");
          toast.error("You must be logged in to select a plan");
          router.push("/login");
          return;
        }

        console.log("Calling subscription status for user:", user.id);
        const subscriptionResponse = await authClient.subscription.status(undefined, { query: { userId: user.id } });
        console.log("Raw subscription response:", subscriptionResponse);
        const { data, error } = subscriptionResponse;
        console.log("Subscription status parsed:", { data, error });

        if (error) {
          console.error("Subscription status error:", error);
          toast.error(error.message || "Failed to check subscription status");
        } else if (data.hasActiveSubscription) {
          toast.success("You already have an active subscription");
          router.push("/dashboard");
        }
      } catch (err) {
        console.error("Unexpected error in checkSubscription:", err);
        toast.error("An unexpected error occurred");
      }
    };

    checkSubscription();
  }, [router]);

  const handleSelectTier = async (plan: string) => {
    try {
      const response = (await authClient.getSession()) as SessionResponse;
      if (response.error || !response.data?.user) {
        toast.error("You must be logged in to select a plan");
        router.push("/login");
        return;
      }

      const { user } = response.data;
      console.log("Creating subscription for user:", user.id, "with plan:", plan);
      const { data: subData, error: subError } = await authClient.subscription.create({
        userId: user.id,
        plan,
      });
      console.log("Create subscription response:", { subData, subError });

      if (subError) {
        toast.error(subError.message || "Failed to select plan");
        return;
      }

      // Create tenant after subscription
      const tenantResponse = await fetch("/api/internal/tenant", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-internal-secret": process.env.NEXT_PUBLIC_INTERNAL_API_SECRET || "your-secret-here",
        },
        body: JSON.stringify({ plan }),
      });

      const tenantData = await tenantResponse.json();
      console.log("Tenant creation response:", tenantData);

      if (!tenantResponse.ok) {
        toast.error(tenantData.error || "Failed to create tenant");
        return;
      }

      toast.success("Plan selected and tenant created!");
      router.push("/dashboard");
    } catch (err) {
      console.error("Unexpected error:", err);
      toast.error("An unexpected error occurred");
    }
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen p-4">
      <h1 className="text-3xl font-bold mb-6">Choose Your Subscription Plan</h1>
      <Pricing />
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-6 w-full max-w-4xl">
        {plans.map((plan) => (
          <div key={plan.name} className="flex justify-center">
            <Button
              onClick={() => handleSelectTier(plan.name)}
              className="w-full max-w-xs"
            >
              Select {plan.name.charAt(0).toUpperCase() + plan.name.slice(1)}
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}