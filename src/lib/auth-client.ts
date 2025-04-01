// /home/zodx/Desktop/trapigram/src/lib/auth-client.ts
import { createAuthClient } from "better-auth/react";
import { subscriptionClientPlugin } from "@/lib/plugins/subscription-client-plugin";

// Extend the AuthClient type to include the subscription plugin
declare module "better-auth/react" {
  interface AuthClient {
    subscription: {
      // Changed from getSubscriptionStatus to status
      status: (data: { userId: string }) => Promise<{
        data: { hasActiveSubscription: boolean };
        error: { status: number; statusText: string } | null;
      }>;
      createSubscription: (data: { userId: string; plan: string }) => Promise<{
        data: { subscription: any };
        error: { message: string } | null;
      }>;
    };
  }
}

export const authClient = createAuthClient({
  baseURL: process.env.BETTER_AUTH_URL || "http://localhost:3000/api/auth",
  plugins: [subscriptionClientPlugin],
  fetchOptions: {
    credentials: "include",
  },
});
