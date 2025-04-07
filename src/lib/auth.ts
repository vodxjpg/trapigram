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

/**
 * Our random utility for generating placeholders.
 * In production, use something more robust if you like.
 */
function randomPassword(): string {
  return Math.random().toString(36).substring(2, 12) + Date.now().toString();
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// Define the magicLink plugin separately so we can use it in organization plugin
const magicLinkPlugin = magicLink({
  expiresIn: 60 * 10, // 10 minutes
  async sendMagicLink({ email, token, url }, request) {
    await sendEmail({
      to: email,
      subject: "Your Magic Link to Trapigram",
      text: `Hey! Click here to sign in: ${url}\n\nThis link will expire soon.`,
    });
  },
});

export const auth = betterAuth({
  database: pool,

  // -------------------------------
  // Email and Password
  // -------------------------------
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

  // -------------------------------
  // Additional user fields
  // -------------------------------
  user: {
    additionalFields: {
      phone: { type: "string", required: true },
      country: { type: "string", required: true },
      is_guest: { type: "boolean", required: true, default: false },
    },
  },

  // -------------------------------
  // Sessions, Rate Limit, etc.
  // -------------------------------
  session: {
    cookieCache: {
      enabled: true,
      maxAge: 50 * 60, // 50 minutes
    },
    cookieOptions: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
    },
  },
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
  api: {
    "/check-email": {
      GET: async (req) => {
        const email = req.query.email as string;
        if (!email) {
          return new Response(JSON.stringify({ error: "Email is required" }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });
        }
        try {
          const row = await db
            .selectFrom("user")
            .select(["id"])
            .where("email", "=", email)
            .executeTakeFirst();
          return new Response(JSON.stringify({ exists: !!row }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
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

  // Just an example custom table (tenant). If not needed, remove.
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

  // -------------------------------
  // PLUGINS
  // -------------------------------
  plugins: [
    // (1) Let folks generate/read API keys
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
        timeWindow: 1000 * 60 * 60 * 24, // 1 day
        maxRequests: 100,
      },
    }),

    // (2) Subscription
    subscriptionPlugin(),

    // (3) MAGIC LINK PLUGIN
    magicLinkPlugin, // Use the separately defined plugin here

    // (4) ORGANIZATION PLUGIN
    organization({
      // (A) Access control
      ac,
      roles: {
        owner,
        manager,
        accountant,
        employee,
      },

      // (B) Send invitation email with magic link
      async sendInvitationEmail(data) {
        const { id, email, role, organization, inviter } = data;

        // 1) Check if user already exists
        const existing = await db
          .selectFrom("user")
          .selectAll()
          .where("email", "=", email)
          .executeTakeFirst();

        // 2) If user doesn’t exist, create one with a random password
        if (!existing) {
          const signupRes = await this.api.signUpEmail({
            body: {
              email,
              password: randomPassword(),
              name: email.substring(0, email.indexOf("@")) || "New User",
              phone: "000",
              country: "ZZ",
              is_guest: true,
            },
          });
          if (signupRes.error) {
            console.error("Error auto-creating user for invitation:", signupRes.error);
          }
        }

        // 3) Generate a magic link token using the magicLinkPlugin we defined
        const token = await magicLinkPlugin.createToken({ email });
        const callbackURL = `${process.env.NEXT_PUBLIC_APP_URL}/accept-invitation/${id}`;
        const magicLinkURL = `${process.env.BETTER_AUTH_URL}/magic-link/verify?token=${encodeURIComponent(token.token)}&callbackURL=${encodeURIComponent(callbackURL)}`;

        // 4) Send the email with the magic link
        await sendEmail({
          to: email,
          subject: `You've been invited to join ${organization.name}`,
          text: `
Hi there!

You were invited by ${inviter.user.name} <${inviter.user.email}> 
to join "${organization.name}" as a ${role}.

Click this link to sign in (or create an account) and accept the invitation:
${magicLinkURL}

If the link doesn’t work, copy and paste it into your browser.

Regards,
The Trapigram Team
          `,
        });
      },

      // (C) Optional hooking into org creation (as you already do)
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
              console.log("No countries found in metadata for org:", organization.id);
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

      // (D) Custom table fields (as you have)
      schema: {
        organization: {
          modelName: "organization",
          fields: {
            countries: "countries",
          },
        },
      },
    }),

    // Keep session cookies in sync with Next's cookies
    nextCookies(),
  ],
});