// /home/zodx/Desktop/trapigram/src/lib/auth.ts
import { Pool } from "pg";
import { betterAuth } from "better-auth";
import { magicLink, organization } from "better-auth/plugins";
import { nextCookies } from "better-auth/next-js";
import { db } from "@/lib/db";
import { sendEmail } from "@/lib/email";
import { subscriptionPlugin } from "@/lib/plugins/subscription-plugin";
import { apiKey } from "better-auth/plugins";
import { ac, owner, manager, accountant, employee } from "@/lib/permissions";
import { createAuthMiddleware } from "better-auth/api";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

export const auth = betterAuth({
  // -------------------------------------------------------------------------
  // Database
  // -------------------------------------------------------------------------
  database: pool,

  // -------------------------------------------------------------------------
  // Trusted Origins
  // -------------------------------------------------------------------------
  trustedOrigins: [
    "http://localhost:3000",
  ],

  // -------------------------------------------------------------------------
  // Hooks
  // -------------------------------------------------------------------------
  hooks: {
    /**
     * Removed the forced `is_guest = true` logic here, because we’re
     * already handling `is_guest` in the `beforeCreate` hook (below).
     */
    after: createAuthMiddleware(async (ctx) => {
      if (ctx.path === "/api/auth/magic-link/verify") {
        const newSession = ctx.context.newSession;
        if (newSession && newSession.user) {
          console.log(
            `hooks.after: User ${newSession.user.email} just verified magic link.`
          );
          // No forced is_guest logic anymore
        }
      }
    }),
  },

  // -------------------------------------------------------------------------
  // Email & Password
  // -------------------------------------------------------------------------
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
    sendResetPassword: async ({ user, url }) => {
      await sendEmail({
        to: user.email,
        subject: "Reset Your Trapigram Password",
        text: `Click this link to reset your password: ${url}`,
      });
    },
  },
  emailVerification: {
    sendVerificationEmail: async ({ user, url }) => {
      await sendEmail({
        to: user.email,
        subject: "Verify Your Trapigram Account",
        text: `Click this link to verify your email: ${url}`,
      });
    },
  },

  // -------------------------------------------------------------------------
  // User Schema
  // -------------------------------------------------------------------------
  user: {
    fields: { is_guest: "is_guest" },
    additionalFields: {
      phone: { type: "string", required: false },
      country: { type: "string", required: false },
      is_guest: { type: "boolean", required: false, defaultValue: false, },
    },
  },

  // -------------------------------------------------------------------------
  // Database Hooks (user beforeCreate)
  // -------------------------------------------------------------------------
  databaseHooks: {
    user: {
      beforeCreate: async (data) => {
        console.log(`beforeCreate: Processing user ${data.email}`);

        // 1) If no name is provided, default to everything before the @
        if (!data.name) {
          const [beforeAt] = data.email.split("@");
          data.name = beforeAt;
          console.log(
            `beforeCreate: No name provided, setting name to "${data.name}" based on email.`
          );
        }

        try {
          // 2) Check if user already exists
          const existingUser = await db
            .selectFrom("user")
            .select(["id"])
            .where("email", "=", data.email)
            .executeTakeFirst();

          if (existingUser) {
            console.log(
              `beforeCreate: User ${data.email} exists, keeping is_guest unchanged`
            );
            return { data };
          }

          // 3) If new user, see if there's a pending invitation
          const invitation = await db
            .selectFrom("invitation")
            .select(["id", "email", "status"])
            .where("email", "=", data.email)
            .where("status", "=", "pending")
            .executeTakeFirst();

          const isGuest = !!invitation;
          console.log(
            `beforeCreate: New user ${data.email}, invitation: ${JSON.stringify(
              invitation
            )}, setting is_guest = ${isGuest}`
          );

          return {
            data: {
              ...data,
              is_guest: isGuest,
            },
          };
        } catch (error) {
          console.error(`beforeCreate: Error for ${data.email}:`, error);
          return { data };
        }
      },
    },
  },

  // -------------------------------------------------------------------------
  // Session
  // -------------------------------------------------------------------------
  session: {
    cookieCache: {
      enabled: true,
      maxAge: 50 * 60, // 50 min
    },
    cookieOptions: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
    },
    async getSession(session) {
      // Check if user has a credential-based password
      // 1) Fetch the full user row
        const userRow = await db
        .selectFrom("user")
        .selectAll()
        .where("id", "=", session.userId)
        .executeTakeFirst();

      // 2) If the userRow is missing, something’s off:
      if (!userRow) {
        console.log("No userRow found for userId:", session.userId);
        return session;
      }

      // 3) Check if there's a credential-based password
      const account = await db
        .selectFrom("account")
        .where("userId", "=", session.userId)
        .where("providerId", "=", "credential")
        .executeTakeFirst();

      const hasPassword = !!account;
      console.log(
        `getSession: user ${session.userId} => hasPassword: ${hasPassword}, is_guest: ${userRow.is_guest}`
      );
      return {
        ...session,
        user: {
          ...session.user,
          hasPassword: !!account,
        },
      };
    },
  },

  // -------------------------------------------------------------------------
  // Rate Limits
  // -------------------------------------------------------------------------
  rateLimit: {
    storage: "database",
    window: 60,
    max: 100,
    customRules: {
      "/check-email": {
        window: 60,
        max: 5,
      },
    },
  },

  // -------------------------------------------------------------------------
  // Custom API Routes
  // -------------------------------------------------------------------------
  api: {
    "/check-email": {
      GET: async (req) => {
        const email = req.query.email as string;
        if (!email) {
          return new Response(
            JSON.stringify({ error: "Email is required" }),
            {
              status: 400,
              headers: { "Content-Type": "application/json" },
            }
          );
        }
        try {
          const row = await db
            .selectFrom("user")
            .select(["id"])
            .where("email", "=", email)
            .executeTakeFirst();
          return new Response(
            JSON.stringify({ exists: !!row }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            }
          );
        } catch (error) {
          console.error("Error checking email:", error);
          return new Response(
            JSON.stringify({ error: "Internal server error" }),
            {
              status: 500,
              headers: { "Content-Type": "application/json" },
            }
          );
        }
      },
    },
  },

  // -------------------------------------------------------------------------
  // Schema / Tenant
  // -------------------------------------------------------------------------
  schema: {
    tenant: {
      fields: {
        ownerUserId: {
          type: "string",
          reference: { model: "user", field: "id", onDelete: "cascade" },
        },
        createdAt: { type: "string" },
        updatedAt: { type: "string" },
        onboardingCompleted: { type: "number", default: 0 },
      },
    },
  },

  // -------------------------------------------------------------------------
  // Plugins
  // -------------------------------------------------------------------------
  plugins: [
    // ----------------- API Key Plugin -----------------
    apiKey({
      enableMetadata: true,
      permissions: {
        defaultPermissions: {
          files: ["read"],
          users: ["read"],
        },
      },
      rateLimit: {
        enabled: true,
        timeWindow: 1000 * 60 * 60 * 24,
        maxRequests: 100,
      },
    }),

    // ----------------- Subscription Plugin -----------------
    subscriptionPlugin(),

    // ----------------- Magic Link Plugin -----------------
    magicLink({
      expiresIn: 60 * 10, // 10 minutes
      disableSignUp: true, // do NOT auto-create new users
      async sendMagicLink({ email, token, url }, request) {
        console.log(`sendMagicLink: Sending to ${email}, URL: ${url}`);
        await sendEmail({
          to: email,
          subject: "Complete Your Trapigram Sign-In",
          text: `Hey! Click here to sign in: ${url}`,
        });
      },
    }),

    // ----------------- Organization Plugin -----------------
    organization({
      ac,
      roles: {
        owner,
        manager,
        accountant,
        employee,
      },
      async sendInvitationEmail(data) {
        const { id, email, role, organization, inviter } = data;
        const inviteLink = `${process.env.NEXT_PUBLIC_APP_URL}/accept-invitation/${id}`;

        await sendEmail({
          to: email,
          subject: `You've been invited to join ${organization.name}`,
          text: `
Hi there!

You were invited by ${inviter.user.name} <${inviter.user.email}> 
to join "${organization.name}" as a ${role}.

Click this link to accept the invitation:
${inviteLink}

If the link doesn’t work, copy and paste it into your browser.

Regards,
The Trapigram Team
          `,
        });

        console.log(`Invitation email sent for ID: ${id} to ${email}`);
      },
      organizationCreation: {
        beforeCreate: async ({ organization, user }, request) => {
          const { rows: tenants } = await pool.query(
            `SELECT id FROM tenant WHERE "ownerUserId" = $1`,
            [user.id]
          );
          if (tenants.length === 0) {
            throw new Error("No tenant found for user");
          }
          const tenantId = tenants[0].id;
          return {
            data: {
              ...organization,
              metadata: {
                ...organization.metadata,
                tenantId,
              },
            },
          };
        },
        afterCreate: async ({ organization, member, user }, request) => {
          try {
            const countriesArr = organization.metadata?.countries;
            if (!countriesArr || !Array.isArray(countriesArr)) {
              console.log(
                "No countries found in metadata for org:",
                organization.id
              );
              return;
            }
            const updateSql = `UPDATE organization SET countries = $1 WHERE id = $2`;
            await pool.query(updateSql, [
              JSON.stringify(countriesArr),
              organization.id,
            ]);
            console.log("[afterCreate] Stored countries for org:", organization.id);
          } catch (err) {
            console.error("[afterCreate] Error storing countries:", err);
          }
        },
      },
      schema: {
        organization: {
          modelName: "organization",
          fields: {
            countries: "countries",
          },
        },
      },
    }),

    // ----------------- Next.js Cookies -----------------
    nextCookies(),
  ],
});
