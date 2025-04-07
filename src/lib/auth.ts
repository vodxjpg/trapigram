// /home/zodx/Desktop/trapigram/src/lib/auth.ts
import { Pool } from "pg";
import { betterAuth } from "better-auth";
import { nextCookies } from "better-auth/next-js";
import { organization } from "better-auth/plugins";
import { db } from "@/lib/db";
import { sendEmail } from "@/lib/email";
import { subscriptionPlugin } from "@/lib/plugins/subscription-plugin";
import { apiKey } from "better-auth/plugins";

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
        maxRequests: 100, // 100 requests per day
      },
    }),
    subscriptionPlugin(),
    organization({
      organizationCreation: {
        beforeCreate: async ({ organization, user }, request) => {
          // Fetch the tenant ID for the user
          const { rows: tenants } = await pool.query(
            `SELECT id FROM tenant WHERE "ownerUserId" = $1`,
            [user.id]
          );
          if (tenants.length === 0) {
            throw new Error("No tenant found for user");
          }
          const tenantId = tenants[0].id;

          // Add tenantId to metadata, preserving existing metadata (e.g., countries)
          return {
            data: {
              ...organization,
              metadata: {
                ...organization.metadata, // Keeps countries if provided
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

            const updateSql = `
              UPDATE organization
              SET countries = $1
              WHERE id = $2
            `;
            await pool.query(updateSql, [
              JSON.stringify(countriesArr),
              organization.id,
            ]);

            console.log(
              "[afterCreate] Stored countries for org:",
              organization.id
            );
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
    nextCookies(),
  ],
});