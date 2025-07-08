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
import { v4 as uuidv4 } from "uuid";

import { resolveRole } from "@/lib/auth/role-resolver";
import { ac } from "@/lib/permissions";

/*───────────────────────────────────────────────────────────────────
  MAIN CONFIG
───────────────────────────────────────────────────────────────────*/
export const auth = betterAuth({
  /*──────────────────── Database ────────────────────*/
  database: pgPool,

  /*──────────────────── Trusted origins ─────────────*/
  trustedOrigins: [process.env.NEXT_PUBLIC_APP_URL],

  /*──────────────────── Hooks ───────────────────────*/
  hooks: {
    after: createAuthMiddleware(async (ctx) => {
      /*------------------------------------------------------------------
        🔒 Single-session enforcement:
        If Better Auth just issued a new session, wipe every other session
        for that user so only the most-recent device stays logged in.
      ------------------------------------------------------------------*/
      const { path, context } = ctx;
      const newSession = context.newSession; // present on any successful sign-in

      /* Optional log for magic-link verification (existing behaviour) */
      if (path === "/api/auth/magic-link/verify" && newSession?.user) {
        console.log(
          `hooks.after: User ${newSession.user.email} just verified magic link.`,
        );
      }

      /* Revoke all *other* sessions to guarantee a single active session */
      if (newSession) {
        try {
          await pgPool.query(
            `DELETE FROM session
             WHERE "userId" = $1
               AND id <> $2`,
            [newSession.userId, newSession.id],
          );
          console.log(
            `[hooks.after] Revoked other sessions for user ${newSession.userId}`,
          );
        } catch (err) {
          console.error("[hooks.after] revokeOtherSessions error:", err);
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

          if (exists) return { data };

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
  },

  /*──────────────────── Session extras ──────────────*/
  session: {
    expiresIn: 60 * 60,
    disableSessionRefresh: true,
    // still cache session data in cookie for performance
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
          return new Response(
            JSON.stringify({ error: "Email is required" }),
            { status: 400, headers: { "Content-Type": "application/json" } },
          );
        }
        try {
          const row = await db
            .selectFrom("user")
            .select("id")
            .where("email", "=", email)
            .executeTakeFirst();
          return new Response(
            JSON.stringify({ exists: !!row }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        } catch (err) {
          console.error("check-email error:", err);
          return new Response(
            JSON.stringify({ error: "Internal server error" }),
            { status: 500, headers: { "Content-Type": "application/json" } },
          );
        }
      },
    },
  },

  /*──────────────────── Schema / Tenant ─────────────*/
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
      roles: resolveRole,
      /* Invitation email */
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

      /* Org creation hooks */
      organizationCreation: {
        beforeCreate: async ({ organization, user }) => {
          /* ensure tenant exists */
          const { rows } = await pgPool.query(
            `SELECT id FROM tenant WHERE "ownerUserId" = $1`,
            [user.id],
          );
          if (rows.length === 0) throw new Error("No tenant found for user");

          const tenantId = rows[0].id;
          const countries = JSON.stringify(
            organization.metadata?.countries ?? [],
          );

          return {
            data: {
              ...organization,
              metadata: { ...organization.metadata, tenantId },
              countries,
              encryptedSecret: "",
            },
          };
        },

        /* Seed default content, use shared pool */
        afterCreate: async ({ organization }) => {
          try {
            /* Store countries */
            if (Array.isArray(organization.metadata?.countries)) {
              await pgPool.query(
                `UPDATE organization SET countries = $1 WHERE id = $2`,
                [
                  JSON.stringify(organization.metadata.countries),
                  organization.id,
                ],
              );
            }

            /* Seed six default sections */
            const defaultSections = [
              {
                name: "help",
                title: "Help",
                content:
                  `<p>Please start by reading the instructions page by typing:</p><p>⎆ /userguide</p><p>You can return to the homepage at any time by typing:</p><p>⎆ /start or /menu</p><p>During the final step, the bot will generate your invoice. Invoices are automatically cancelled if payment is not received within 60 minutes.</p><p>Your invoice will be in either Tether (USDT), Ethereum (ETH), Bitcoin (BTC), Ripple (XRP), or Solano (SOL) depending on your payment choice.</p><p>If you are new to crypto payments I would suggest setting up Coinbase/crypto.com to save on fees or you can purchase crypto with apple pay/google pay/debit card via www.swapped.com/buy/usdt</p><p>Happy shopping 🛍️</p><p>⎆ Type /menu then click the Products button</p><p>⎆ Or just type /products</p><p>﹎﹎﹎﹎﹎﹎﹎</p><p>We believe in offering our customers the best service possible—and we will do everything to make it happen!</p><p>X</p>`,
                videoUrl: null,
                parentSectionId: null,
              },
              {
                name: "coupons",
                title: "Coupons",
                content:
                  `<p>📢 Coupons Section 📢</p><p><br /></p><p>Here you will find all available coupons we have for you.</p><p>﹎﹎﹎﹎﹎﹎﹎</p><p>👉 You can copy the coupon code by clicking on it</p><p>👉 Just type the coupon code you would like to use in the checkout section</p><p>⚠️ Typing a discount code in the address fields will eliminate any applied discount.</p><p>﹎﹎﹎﹎﹎﹎﹎</p><p>The Team ®</p>`,
                videoUrl: null,
                parentSectionId: null,
              },
              {
                name: "faqs",
                title: "Faqs",
                content:
                  `<p>🤔 : How do I cancel the order?</p><p>💁‍ : You are able to cancel your order just by not paying for it. Think twice before you pay. As soon as we receive the callback, there is no way your order can be canceled.</p><p>{separator}</p><p>🤔 : What do I do if I have not received my order?</p><p>💁‍ : Our experience shows that 98% percent of the reasons why customers do not receive their orders is a wrong delivery address provided. Always double-check the address before sending it to us.</p><p>If the address is correct, there is no reason why you would not receive it.</p><p>On the other hand, if the reason of your order not arriving is known to us, we will definitely find a solution.</p>`,
                videoUrl: null,
                parentSectionId: null,
              },
              {
                name: "guide",
                title: "User guide",
                content:
                  `<p>There are four places where you will interact with the bot:</p><p>﹎﹎﹎﹎﹎﹎﹎</p><p>⚜️ Discount Codes: Type in a discount code.</p><p>⚜️ Messages: Write a message in the bot chat for support.</p><p>⚜️ Address: Enter your delivery address with a secure Privyxnote.</p><p>⚜️ Delete Order: To delete an order.</p><p>﹎﹎﹎﹎﹎﹎﹎</p><p>👉 Please select one of the help topics by clicking the corresponding button below for more information on each process.</p><p>👉 Or you can always reach customer support</p><p>﹎﹎﹎﹎﹎﹎﹎</p><p>The Team ®</p>`,
                videoUrl: null,
                parentSectionId: null,
              },
              {
                name: "services",
                title: "Services",
                content:
                  `<p>📢 Friendly services 📢</p><p><br /></p><p>If you want to get notified for new product launches, promotions, and staying connected in case telegram shuts us down simply register your email to our friendly service by clicking the save email button.</p>`,
                videoUrl: null,
                parentSectionId: null,
              },
              {
                name: "affiliates",
                title: "Affiliates",
                content:
                  `<p>Referral program</p><p>﹎﹎﹎﹎﹎﹎﹎</p><p>📈 Referral Stat :</p><p><br /></p><p>👨‍👩‍👧‍👦 Referred <strong>users</strong> : {user_affiliate_referrals_count}</p><p>📦 Orders-ref users : {user_affiliate_orders_count}</p><p>Your level: {user_affiliate_level}</p><p>❇️ Available Points : {user_affiliate_points}</p><p>💸 Points already spent: {user_affiliate_points_spent}</p><p>Total points: {user_affiliate_total_points}</p><p><br /></p><p>﹎﹎﹎﹎﹎﹎﹎</p><p>The best way to get points is inviting friends to buy with us, leaving a review for your order and joining our backup community groups.</p><p><br /></p><p>﹎﹎﹎﹎﹎﹎﹎</p><p>How to Earn Points:</p><p>+X point for every £50 spent</p><p>+X point for leaving a review</p><p>+X point when you invite a friend through your referral link and each time they place an order</p><p>+X point when you.join a backup page/channel</p><p><br /></p><p>﹎﹎﹎﹎﹎﹎﹎</p><p>How to Spend Points:</p><p>-Points can be exchanged for items and products (Ref &amp; Earn &gt; Redeem points)</p><p><br /></p><p>We value your trust and confidence in us and sincerely appreciate you!</p>`,
                videoUrl: null,
                parentSectionId: null,
              },
              {
                name: "intro",
                title: "Intro",
                content:
                  `<p>Welcome to X self-service vape shop 🍃.</p><p><br /></p><p>Ships From/To: United Kingdom 🇬🇧 / 🇪🇺 European Union⚡️🚚</p><p>Currency: GBP / EUR 💷💶</p><p>Currently Accepting: Crypto Tether (USDT), Ethereum (ETH), Bitcoin (BTC), and Solana (SOL)</p><p><br /></p><p>Rating &amp; Reviews: {review_summary}</p><p>🆓🚚 Free UK tracked next day delivery on orders over £250 / Free EU tracked 2 - 4 days delivery on orders over €300!</p><p>⏰ Place your order before 2:00 PM Monday - Friday, and we'll dispatch it on the same day! All orders placed after 2:00 PM will be dispatched on the next business day.</p><p><br /></p><p>﹎﹎﹎﹎﹎﹎﹎</p><p>Start with Help! /userguide 📘.</p><p>Type /menu then click Products (Button) or just type in /products 📦.</p><p>Type /coupons to find discount codes 💰.Happy shopping 🛍️</p><p>﹎﹎﹎﹎﹎﹎﹎</p><p><br /></p><p>Note: For Spain and Portugal we only ship to Mainland and not the islands.</p><p><br /></p><p>Peace and Love ✌️❤️</p><p>X's team ®</p><p>Telegram Support: @Xteam 📢</p><p>Instagram: @Xteam (https://www.instagram.com/xxx/) 📸</p>`,
                videoUrl: null,
                parentSectionId: null,
              },
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
            console.log(
              `[afterCreate] seeded sections for org ${organization.id}`,
            );
          } catch (err) {
            console.error("[afterCreate] seeding error:", err);
          }
        },
      },

      /* Extend org model */
      schema: {
        organization: {
          modelName: "organization",
          fields: { countries: "countries" },
        },
      },
    }),

    /* Next-js cookie helper*/
    nextCookies(),
  ],
});
