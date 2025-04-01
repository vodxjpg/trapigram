// /home/zodx/Desktop/trapigram/src/lib/auth.ts
import { Pool } from "pg";  
import { betterAuth } from "better-auth";
import { nextCookies } from "better-auth/next-js";
import { db } from "@/lib/db";       // <-- Our Kysely instance
import { sendEmail } from "@/lib/email";
import { subscriptionPlugin } from "@/lib/plugins/subscription-plugin";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

export const auth = betterAuth({
  // Pass the Kysely instance here
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
      httpOnly: true, // Prevents client-side JS from accessing the cookie
      secure: process.env.NODE_ENV === "production", // Use HTTPS in production
      sameSite: "lax", // Allows cookie to be sent on top-level navigations (like redirects)
      path: "/", // Ensures cookie is available site-wide
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

  // Example rewriting check-email route using Kysely queries:
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

  schema: {
    tenant: {
      fields: {
        // Instead of "references: { table: 'user', ... }":
        ownerUserId: {
          type: "string",
          reference: {
            model: "user",
            field: "id",
            onDelete: "cascade",
          },
        },
        createdAt: { type: "string" },
        updatedAt: { type: "string" },
        onboardingCompleted: { type: "number", default: 0 },
      },
    },
  },

  plugins: [
    subscriptionPlugin(),
    nextCookies(),
  ],
});
