// /home/zodx/Desktop/trapigram/src/lib/auth-client.ts
import { createAuthClient } from "better-auth/react";
import { organizationClient } from "better-auth/client/plugins"; // Add organization client
import { subscriptionClientPlugin } from "@/lib/plugins/subscription-client-plugin";

// Extend the AuthClient type
declare module "better-auth/react" {
  interface AuthClient {
    organization: {
      create: (data: { name: string; slug: string; metadata?: any }) => Promise<{
        data: any;
        error: { message: string } | null;
      }>;
      list: () => Promise<{ data: any[]; error: any }>;
    };
    subscription: {
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
  plugins: [
    organizationClient(),
    subscriptionClientPlugin,
  ],
  fetchOptions: {
    credentials: "include",
  },
});