// /home/zodx/Desktop/trapigram/src/lib/auth-client.ts
import { createAuthClient } from "better-auth/react";
import { organizationClient } from "better-auth/client/plugins";
import { magicLinkClient } from "better-auth/client/plugins"; // Add this import
import { subscriptionClientPlugin } from "@/lib/plugins/subscription-client-plugin";
import { apiKeyClient } from "better-auth/client/plugins";
import { ac, owner, manager, accountant, employee } from "@/lib/permissions";

declare module "better-auth/react" {
  interface AuthClient {
    organization: {
      create: (data: { name: string; slug: string; metadata?: any }) => Promise<{
        data: any;
        error: { message: string } | null;
      }>;
      list: () => Promise<{ data: any[]; error: any }>;
      delete: (data: { organizationId: string }) => Promise<any>;
      update: (data: { data: { name: string; slug: string }; organizationId: string }) => Promise<any>;
      checkSlug: (data: { slug: string }) => Promise<{ data: { available: boolean }; error: any }>;
      getFullOrganization: (data: { organizationSlug: string }) => Promise<{ data: any; error: any }>;
      getMembers: (data: { organizationId: string }) => Promise<{ data: any[]; error: any }>;
      updateMemberRole: (data: { memberId: string; role: string }) => Promise<any>;
      removeMember: (data: { memberIdOrEmail: string; organizationId: string }) => Promise<any>;
      getActiveMember: () => Promise<{ data: { role: string }; error: any }>;
      getInvitations: (data: { organizationId: string }) => Promise<{ data: any[]; error: any }>;
      cancelInvitation: (data: { invitationId: string }) => Promise<any>;
      inviteMember: (data: { email: string; role: string; organizationId: string }) => Promise<any>;
      acceptInvitation: (data: { invitationId: string }) => Promise<any>;
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
    signIn: {
      magicLink: (data: { email: string; callbackURL?: string }) => Promise<{
        data: any;
        error: { message: string; status: number } | null;
      }>;
      // Include existing email sign-in for completeness
      email: (data: { email: string; password: string }) => Promise<{
        data: any;
        error: { message: string; status: number } | null;
      }>;
    };
    magicLink: {
      verify: (data: { query: { token: string } }) => Promise<{
        data: any;
        error: { message: string; status: number } | null;
      }>;
    };
  }
}

export const authClient = createAuthClient({
  baseURL: process.env.BETTER_AUTH_URL || "https://trapigram.vercel.app/api/auth",
  plugins: [
    apiKeyClient(),
    organizationClient({
      ac,
      roles: {
        owner,
        manager,
        accountant,
        employee,
      },
    }),
    subscriptionClientPlugin,
    magicLinkClient(), // Add the magic link client plugin
  ],
  fetchOptions: {
    credentials: "include",
  },
});