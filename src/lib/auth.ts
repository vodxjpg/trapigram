// /home/zodx/Desktop/trapigram/src/lib/auth.ts
import { Pool } from "pg";  
import { betterAuth } from "better-auth";
import { nextCookies } from "better-auth/next-js";
import { organization } from "better-auth/plugins"; // Add organization plugin
import { db } from "@/lib/db";
import { sendEmail } from "@/lib/email";
import { subscriptionPlugin } from "@/lib/plugins/subscription-plugin";
import { apiKey } from "better-auth/plugins"

// (NEW) We'll also need a direct query for the "afterCreate" hook:
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

export const auth = betterAuth({
  database: pool,
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
  user: {
    additionalFields: {
      phone: { type: "string", required: true },
      country: { type: "string", required: true },
      is_guest: { type: "boolean", required: true, default: false },
    },
  },
  session: {
    cookieCache: {
      enabled: true,
      maxAge: 50 * 60,
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
          return new Response(JSON.stringify({ error: "Internal server error" }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }
      },
    },
  },
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
  plugins: [
    apiKey({
      enableMetadata: true
    }),
    subscriptionPlugin(),
    organization({
      /**
       * (NEW) The 'afterCreate' hook runs AFTER the org row is inserted
       * by Better Auth. We'll do a direct DB update to store the "countries"
       * array that was passed in "metadata.countries".
       *
       * If your "beforeCreate" never runs or never updates the DB for some reason,
       * 'afterCreate' definitely does. We have the final "organization" object
       * (with ID, etc.).
       */
      organizationCreation: {
        async afterCreate({ organization, member, user }, request) {
          try {
            // If the user provided "metadata.countries" at creation time, 
            // it should appear in 'organization.metadata'
            // If not, do nothing.
            const countriesArr = organization.metadata?.countries;
            if (!countriesArr || !Array.isArray(countriesArr)) {
              console.log("No countries found in metadata for org:", organization.id);
              return;
            }

            // Do a direct query to update the 'countries' column in 'organization'
            // This relies on your DB having: organization(countries TEXT)
            const updateSql = `
              UPDATE organization
              SET countries = $1
              WHERE id = $2
            `;
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

      /**
       * Map the 'countries' column if you want the plugin to see it. 
       * This is optional, but let's keep it consistent:
       */
      schema: {
        organization: {
          modelName: "organization",
          fields: {
            countries: "countries",
          },
        },
      },
    }),
    nextCookies(),
  ],
});
