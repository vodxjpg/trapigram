'use client';

import { useEffect } from "react";
import { authClient } from "@/lib/auth-client";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import Pricing from "@/components/Pricing/Pricing";

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
        if (response.error || !response.data) {
          toast.error("You must be logged in to select a plan");
          router.push("/login");
          return;
        }

        const { user } = response.data;
        if (!user) {
          toast.error("You must be logged in to select a plan");
          router.push("/login");
          return;
        }

        const subscriptionResponse = await authClient.subscription.status(undefined, {
          query: { userId: user.id },
        });
        const { data, error } = subscriptionResponse;

        if (error) {
          toast.error(error.message || "Failed to check subscription status");
        } else if (data.hasActiveSubscription) {
          toast.success("You already have an active subscription");
          router.push("/dashboard");
        }
      } catch (err) {
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
      const { data: subData, error: subError } = await authClient.subscription.create({
        userId: user.id,
        plan,
      });

      if (subError) {
        toast.error(subError.message || "Failed to select plan");
        return;
      }

      const tenantResponse = await fetch("/api/internal/tenant", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-internal-secret":
            process.env.NEXT_PUBLIC_INTERNAL_API_SECRET || "your-secret-here",
        },
        body: JSON.stringify({ plan }),
      });

      const tenantData = await tenantResponse.json();
      if (!tenantResponse.ok) {
        toast.error(tenantData.error || "Failed to create tenant");
        return;
      }

      toast.success("Plan selected and tenant created!");
      router.push("/dashboard");
    } catch (err) {
      toast.error("An unexpected error occurred");
    }
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen p-4">
      <h1 className="text-3xl font-bold mb-6">Choose Your Subscription Plan</h1>
      <Pricing onSelectTier={handleSelectTier} />
    </div>
  );
}
