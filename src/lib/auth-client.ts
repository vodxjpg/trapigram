/* -------------------------------------------------------------------------- */
/*  /src/lib/auth-client.ts                                                   */
/* -------------------------------------------------------------------------- */

import { createAuthClient }         from "better-auth/react";
import { organizationClient }       from "better-auth/client/plugins";
import { magicLinkClient }          from "better-auth/client/plugins";
import { subscriptionClientPlugin } from "@/lib/plugins/subscription-client-plugin";
import { apiKeyClient }             from "better-auth/client/plugins";
import { ac, owner }                from "@/lib/permissions";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL;

/* ──────────────────────────────── TYPES ──────────────────────────────────── */
declare module "better-auth/react" {
  interface AuthClient {
    /* ─────── Organizations & subscriptions (unchanged) ─────── */
    organization: {
      create: (data: { name: string; slug: string; metadata?: any }) =>
        Promise<{ data: any; error: { message: string } | null }>;
      list: () => Promise<{ data: any[]; error: any }>;
      delete: (data: { organizationId: string }) => Promise<any>;
      update: (data: {
        data: { name: string; slug: string };
        organizationId: string;
      }) => Promise<any>;
      checkSlug: (data: { slug: string }) => Promise<{
        data: { available: boolean };
        error: any;
      }>;
      getFullOrganization: (data: { organizationSlug: string }) => Promise<{
        data: any;
        error: any;
      }>;
      getMembers: (data: { organizationId: string }) => Promise<{
        data: any[];
        error: any;
      }>;
      updateMemberRole: (data: { memberId: string; role: string }) => Promise<any>;
      removeMember: (data: {
        memberIdOrEmail: string;
        organizationId: string;
      }) => Promise<any>;
      getActiveMember: () => Promise<{ data: { role: string }; error: any }>;
      getInvitations: (data: { organizationId: string }) => Promise<{
        data: any[];
        error: any;
      }>;
      cancelInvitation: (data: { invitationId: string }) => Promise<any>;
      inviteMember: (data: {
        email: string;
        role: string;
        organizationId: string;
      }) => Promise<any>;
      acceptInvitation: (data: { invitationId: string }) => Promise<any>;

      /* ▶︎  NEW helper so any component can flush the permission cache  */
      invalidatePermissionCache?: () => void;
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

    /* ───────────────────────────── Sign-in ─────────────────────────────── */
    signIn: {
      magicLink: (data: {
        email: string;
        callbackURL?: string;
      }) => Promise<{
        data: any;
        error: { message: string; status: number } | null;
      }>;
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

    /* ─────────────────────────── NEW ↓↓↓ ──────────────────────────────── */
    forgetPassword: (data: { email: string; redirectTo: string }) => Promise<{
      data: any;
      error: { message: string; status: number } | null;
    }>;
    resetPassword: (data: { newPassword: string; token: string }) => Promise<{
      data: any;
      error: { message: string; status: number } | null;
    }>;
  }
}

/* ─────────────────────────── CLIENT INSTANCE ───────────────────────────── */
export const authClient = createAuthClient({
  baseURL: APP_URL
    ? `${APP_URL.replace(/\/$/, "")}/api/auth`
    : "https://www.trapyfy.com/api/auth",
  plugins: [
    apiKeyClient(),
    organizationClient({ ac, roles: { owner } }),
    subscriptionClientPlugin,
    magicLinkClient(),
  ],
  fetchOptions: { credentials: "include" },
});

/* ──────────────────── invalidate-permission-cache helper ─────────────────── */
if (typeof window !== "undefined") {
  // ① Expose a helper every component can call (e.g. after saving a role)
  (authClient.organization as any).invalidatePermissionCache = () => {
    window.dispatchEvent(new Event("better-auth:invalidate-cache"));
  };

  // ② Augment Window so TS knows about the counter we bump
  declare global {
    interface Window {
      __permissionGeneration__?: number;
    }
  }

  // ③ When the event fires, bump the global counter so usePermission re-runs
  window.addEventListener("better-auth:invalidate-cache", () => {
    window.__permissionGeneration__ =
      (window.__permissionGeneration__ || 0) + 1;
  });
}
