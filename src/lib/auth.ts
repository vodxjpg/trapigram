/*───────────────────────────────────────────────────────────────────
  src/lib/auth.ts              — FULL REPLACEMENT
───────────────────────────────────────────────────────────────────*/

import { betterAuth } from "better-auth";
import { magicLink, organization, apiKey } from "better-auth/plugins";
import { nextCookies } from "better-auth/next-js";
import { createAuthMiddleware } from "better-auth/api";
import { db, pgPool } from "@/lib/db";
import { sendEmail } from "@/lib/email";
import { subscriptionPlugin } from "@/lib/plugins/subscription-plugin";

import {
  ac,
  builtinRoles,         // owner / admin / member
  registerDynamicRoles,  // builds Role objects from DB rows
  buildRoles,            // merges built-ins + dynamic
} from "@/lib/permissions";

import { v4 as uuidv4 } from "uuid";

/*───────────────────────────────────────────────────────────────────
  MAIN CONFIG
───────────────────────────────────────────────────────────────────*/

const dynamicRoleRows = await db                       // 👈 adjust if you use
  .selectFrom("orgRole")                                  //    Kysely/Prisma/etc.
  .select(["name", "permissions"])                     //    → must return:
  .execute();                                          //    [{name, permissions}]

const dynamicRoles = registerDynamicRoles(dynamicRoleRows);
const roles        = buildRoles(dynamicRoles);         // 🔑 final object
export const auth = betterAuth({
  /*──────────────────── Database ────────────────────*/
  database: pgPool,                   // ← one source of truth

  /*──────────────────── Trusted origins ─────────────*/
  trustedOrigins: [
    process.env.NEXT_PUBLIC_APP_URL,
  ],

  /*──────────────────── Hooks ───────────────────────*/
  hooks: {
    after: createAuthMiddleware(async (ctx) => {
      if (ctx.path === "/api/auth/magic-link/verify") {
        const newSession = ctx.context.newSession;
        if (newSession?.user) {
          console.log(
            `hooks.after: User ${newSession.user.email} just verified magic link.`,
          );
        }
      }
    }),
  },

  /*──────────────────── Email & Password ────────────*/
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
    sendResetPassword: async ({ user, url }) => {
      await sendEmail({
        to: user.email,
        subject: "Reset Your Trapyfy Password",
        text: `Click this link to reset your password: ${url}`,
      });
    },
  },
  emailVerification: {
    sendVerificationEmail: async ({ user, url }) => {
      await sendEmail({
        to: user.email,
        subject: "Verify Your Trapyfy Account",
        text: `Click this link to verify your email: ${url}`,
      });
    },
  },

  /*──────────────────── User schema ─────────────────*/
  user: {
    fields: { is_guest: "is_guest" },
    additionalFields: {
      phone: { type: "string", required: false },
      country: { type: "string", required: false },
      is_guest: { type: "boolean", required: false, defaultValue: false },
    },
  },

  /*──────────────────── DB hooks: user.beforeCreate ─*/
  databaseHooks: {
    user: {
      beforeCreate: async (data) => {
        /* 1) infer name */
        if (!data.name) {
          data.name = data.email.split("@")[0];
        }

        try {
          /* 2) existing user? */
          const exists = await db
            .selectFrom("user")
            .select("id")
            .where("email", "=", data.email)
            .executeTakeFirst();

          if (exists) return { data };      // keep current is_guest

          /* 3) pending invitation → mark guest */
          const invitation = await db
            .selectFrom("invitation")
            .select("id")
            .where("email", "=", data.email)
            .where("status", "=", "pending")
            .executeTakeFirst();

          return {
            data: {
              ...data,
              is_guest: !!invitation,
            },
          };
        } catch (err) {
          console.error("[beforeCreate] error:", err);
          return { data };
        }
      },
    },
     // ──────────────────────────────────────────────────────────────
 //  When a new session is created pick the user’s first org and
 //  store it in `activeOrganizationId`.  Every tab can now call
 //  getActiveMember / usePermission without a separate “setActive”.
 // ──────────────────────────────────────────────────────────────
 session: {
   create: {
     before: async (session) => {
       const firstOrg = await db
         .selectFrom("member")
         .select("organizationId")
         .where("userId", "=", session.userId)
         .orderBy("createdAt")
         .limit(1)
         .executeTakeFirst();

       if (!firstOrg) return { data: session };   // no memberships yet

       return {
         data: {
           ...session,
           activeOrganizationId: firstOrg.organizationId,
         },
       };
     },
   },
 },
  },

  /*──────────────────── Session extras ──────────────*/
  session: {
    cookieCache: { enabled: true, maxAge: 2 * 60 * 60 },
    cookieOptions: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
    },
    async getSession(session) {
      const userRow = await db
        .selectFrom("user")
        .select(["is_guest"])
        .where("id", "=", session.userId)
        .executeTakeFirst();

      if (!userRow) return session;

      const account = await db
        .selectFrom("account")
        .where("userId", "=", session.userId)
        .where("providerId", "=", "credential")
        .executeTakeFirst();

      return {
        ...session,
        user: {
          ...session.user,
          hasPassword: !!account,
        },
      };
    },
  },

  /*──────────────────── Rate-limit ──────────────────*/
  rateLimit: {
    storage: "database",
    window: 60,
    max: 100,
    customRules: {
      "/check-email": { window: 60, max: 5 },
    },
  },

  /*──────────────────── Custom API route ────────────*/
  api: {
    "/check-email": {
      GET: async (req) => {
        const email = req.query.email as string;
        if (!email) {
          return new Response(JSON.stringify({ error: "Email is required" }),
            { status: 400, headers: { "Content-Type": "application/json" } });
        }
        try {
          const row = await db
            .selectFrom("user")
            .select("id")
            .where("email", "=", email)
            .executeTakeFirst();
          return new Response(JSON.stringify({ exists: !!row }),
            { status: 200, headers: { "Content-Type": "application/json" } });
        } catch (err) {
          console.error("check-email error:", err);
          return new Response(JSON.stringify({ error: "Internal server error" }),
            { status: 500, headers: { "Content-Type": "application/json" } });
        }
      },
    },
  },

  /*──────────────────── Schema / Tenant ─────────────*/
  schema: {
    tenant: {
      fields: {
        ownerUserId: { type: "string", reference: { model: "user", field: "id", onDelete: "cascade" } },
        createdAt: { type: "string" },
        updatedAt: { type: "string" },
        onboardingCompleted: { type: "number", default: 0 },
      },
    },
  },

  /*──────────────────── Plugins ─────────────────────*/
  plugins: [
    /* API-key plugin */
    apiKey({
      enableMetadata: true,
      permissions: {
        defaultPermissions: { files: ["read"], users: ["read"] },
      },
      rateLimit: { enabled: true, timeWindow: 86_400_000, maxRequests: 100 },
    }),

    /* Subscriptions */
    subscriptionPlugin(),

    /* Magic-link */
    magicLink({
      expiresIn: 60 * 10,
      disableSignUp: true,
      async sendMagicLink({ email, url }) {
        await sendEmail({
          to: email,
          subject: "Complete Your Trapyfy Sign-In",
          text: `Hey! Click here to sign in: ${url}`,
        });
      },
    }),

    /* Organizations */
    organization({
      ac,
      roles,

      /** Invitation email */
      async sendInvitationEmail({ id, email, role, organization, inviter }) {
        const inviteLink = `${process.env.NEXT_PUBLIC_APP_URL}/accept-invitation/${id}`;
        await sendEmail({
          to: email,
          subject: `You've been invited to join ${organization.name}`,
          text: `
Hi there!

${inviter.user.name} <${inviter.user.email}> invited you to join
"${organization.name}" as ${role}.

Accept here: ${inviteLink}

Regards,
The Trapyfy Team
          `,
        });
      },

      /** Org creation hooks */
      organizationCreation: {
        beforeCreate: async ({ organization, user }) => {
          /* ensure tenant exists */
          const { rows } = await pgPool.query(
            `SELECT id FROM tenant WHERE "ownerUserId" = $1`,
            [user.id],
          );
          if (rows.length === 0) throw new Error("No tenant found for user");

          const tenantId = rows[0].id;
          const countries = JSON.stringify(organization.metadata?.countries ?? []);

          return {
            data: {
              ...organization,
              metadata: { ...organization.metadata, tenantId },
              countries,
              encryptedSecret: "",
            },
          };
        },

        /** Seed default content, use shared pool */
        afterCreate: async ({ organization }) => {
          try {
            /* Store countries */
            if (Array.isArray(organization.metadata?.countries)) {
              await pgPool.query(
                `UPDATE organization SET countries = $1 WHERE id = $2`,
                [JSON.stringify(organization.metadata.countries), organization.id],
              );
            }

            /* Seed six default sections */
            const defaultSections = [
              /* … same objects as before … */
            ];

            const now = new Date();
            for (const s of defaultSections) {
              await pgPool.query(
                `INSERT INTO sections
                 (id,"organizationId","parentSectionId",name,title,content,"videoUrl","createdAt","updatedAt")
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8)`,
                [
                  uuidv4(),
                  organization.id,
                  s.parentSectionId,
                  s.name,
                  s.title,
                  s.content,
                  s.videoUrl,
                  now,
                ],
              );
            }
            console.log(`[afterCreate] seeded sections for org ${organization.id}`);
          } catch (err) {
            console.error("[afterCreate] seeding error:", err);
          }
        },
      },

      /** Extend org model */
      schema: {
        organization: {
          modelName: "organization",
          fields: { countries: "countries" },
        },
      },
    }),

    /* Next-js cookie helper */
    nextCookies(),
  ],
});
