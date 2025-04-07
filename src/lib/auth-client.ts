// /home/zodx/Desktop/trapigram/src/lib/auth-client.ts
import { createAuthClient } from "better-auth/react";
import { organizationClient } from "better-auth/client/plugins";
import { subscriptionClientPlugin } from "@/lib/plugins/subscription-client-plugin";
import { apiKeyClient } from "better-auth/client/plugins";
import { ac, owner, manager, accountant, employee } from "@/lib/permissions";

// Extend the AuthClient type
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
  ],
  fetchOptions: {
    credentials: "include",
  },
});