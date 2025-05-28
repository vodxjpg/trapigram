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
import { v4 as uuidv4 } from "uuid";

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
    process.env.NEXT_PUBLIC_APP_URL,
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
          // 1) Ensure tenant exists
          const { rows: tenants } = await pool.query(
            `SELECT id FROM tenant WHERE "ownerUserId" = $1`,
            [user.id]
          );
          if (tenants.length === 0) {
            throw new Error("No tenant found for user");
          }
          const tenantId = tenants[0].id;

          // 2) Prepare countries JSON for NOT NULL column
          const countriesArr = organization.metadata?.countries;
          const countriesJson = Array.isArray(countriesArr)
            ? JSON.stringify(countriesArr)
            : JSON.stringify([]);

          return {
            data: {
              ...organization,
              metadata: {
                ...organization.metadata,
                tenantId,
              },
              countries: countriesJson,
              encryptedSecret: ""    // ← inject here
            },
          };
        },
        afterCreate: async ({ organization }) => {
          try {
            // Update stored countries
            const countriesArr = organization.metadata?.countries;
            if (Array.isArray(countriesArr)) {
              await pool.query(
                `UPDATE organization SET countries = $1 WHERE id = $2`,
                [JSON.stringify(countriesArr), organization.id]
              );
              console.log("[afterCreate] Stored countries for org:", organization.id);
            }

            // Seed default sections
            const defaultSections = [
              {
                name: "help",
                title: "Help",
                content: `<p>Please start by reading the instructions page by typing:</p><p>⎆ /userguide</p><p>You can return to the homepage at any time by typing:</p><p>⎆ /start or /menu</p><p>During the final step, the bot will generate your invoice. Invoices are automatically cancelled if payment is not received within 60 minutes.</p><p>Your invoice will be in either Tether (USDT), Ethereum (ETH), Bitcoin (BTC), Ripple (XRP), or Solano (SOL) depending on your payment choice.</p><p>If you are new to crypto payments I would suggest setting up Coinbase/crypto.com to save on fees or you can purchase crypto with apple pay/google pay/debit card via www.swapped.com/buy/usdt</p><p>Happy shopping 🛍️</p><p>⎆ Type /menu then click the Products button</p><p>⎆ Or just type /products</p><p>﹎﹎﹎﹎﹎﹎﹎</p><p>We believe in offering our customers the best service possible—and we will do everything to make it happen!</p><p>X</p>`,
                videoUrl: null,
                parentSectionId: null,
              },
              {
                name: "coupons",
                title: "Coupons",
                content: `<p>📢 Coupons Section 📢</p><p><br /></p><p>Here you will find all available coupons we have for you.</p><p>﹎﹎﹎﹎﹎﹎﹎</p><p>👉 You can copy the coupon code by clicking on it</p><p>👉 Just type the coupon code you would like to use in the checkout section</p><p>⚠️ Typing a discount code in the address fields will eliminate any applied discount.</p><p>﹎﹎﹎﹎﹎﹎﹎</p><p>The Team ®</p>`,
                videoUrl: null,
                parentSectionId: null,
              },
              {
                name: "faqs",
                title: "Faqs",
                content: `<p>🤔 : How do I cancel the order?</p><p>💁‍ : You are able to cancel your order just by not paying for it. Think twice before you pay. As soon as we receive the callback, there is no way your order can be canceled.</p><p>{separator}</p><p>🤔 : What do I do if I have not received my order?</p><p>💁‍ : Our experience shows that 98% percent of the reasons why customers do not receive their orders is a wrong delivery address provided. Always double-check the address before sending it to us.</p><p>If the address is correct, there is no reason why you would not receive it.</p><p>On the other hand, if the reason of your order not arriving is known to us, we will definitely find a solution.</p>`,
                videoUrl: null,
                parentSectionId: null,
              },
              {
                name: "guide",
                title: "User guide",
                content: `<p>There are four places where you will interact with the bot:</p><p>﹎﹎﹎﹎﹎﹎﹎</p><p>⚜️ Discount Codes: Type in a discount code.</p><p>⚜️ Messages: Write a message in the bot chat for support.</p><p>⚜️ Address: Enter your delivery address with a secure Privyxnote.</p><p>⚜️ Delete Order: To delete an order.</p><p>﹎﹎﹎﹎﹎﹎﹎</p><p>👉 Please select one of the help topics by clicking the corresponding button below for more information on each process.</p><p>👉 Or you can always reach customer support</p><p>﹎﹎﹎﹎﹎﹎﹎</p><p>The Team ®</p>`,
                videoUrl: null,
                parentSectionId: null,
              },
              {
                name: "services",
                title: "Services",
                content: `<p>📢 Friendly services 📢</p><p><br /></p><p>If you want to get notified for new product launches, promotions, and staying connected in case telegram shuts us down simply register your email to our friendly service by clicking the save email button.</p>`,
                videoUrl: null,
                parentSectionId: null,
              },
              {
                name: "affiliates",
                title: "Affiliates",
                content: `<p>Referral program</p><p>﹎﹎﹎﹎﹎﹎﹎</p><p>📈 Referral Stat :</p><p><br /></p><p>👨‍👩‍👧‍👦 Referred <strong>users</strong> : {user_affiliate_referrals_count}</p><p>📦 Orders-ref users : {user_affiliate_orders_count}</p><p>Your level: {user_affiliate_level}</p><p>❇️ Available Points : {user_affiliate_points}</p><p>💸 Points already spent: {user_affiliate_points_spent}</p><p>Total points: {user_affiliate_total_points}</p><p><br /></p><p>﹎﹎﹎﹎﹎﹎﹎</p><p>The best way to get points is inviting friends to buy with us, leaving a review for your order and joining our backup community groups.</p><p><br /></p><p>﹎﹎﹎﹎﹎﹎﹎</p><p>How to Earn Points:</p><p>+X point for every £50 spent</p><p>+X point for leaving a review</p><p>+X point when you invite a friend through your referral link and each time they place an order</p><p>+X point when you join a backup page/channel</p><p><br /></p><p>﹎﹎﹎﹎﹎﹎﹎</p><p>How to Spend Points:</p><p>-Points can be exchanged for items and products (Ref &amp; Earn &gt; Redeem points)</p><p><br /></p><p>We value your trust and confidence in us and sincerely appreciate you!</p>`,
                videoUrl: null,
                parentSectionId: null,
              },
              {
                name: "intro",
                title: "Intro",
                content: `<p>Welcome to X self-service vape shop 🍃.</p><p><br /></p><p>Ships From/To: United Kingdom 🇬🇧 / 🇪🇺 European Union⚡️🚚</p><p>Currency: GBP / EUR 💷💶</p><p>Currently Accepting: Crypto Tether (USDT), Ethereum (ETH), Bitcoin (BTC), and Solana (SOL)</p><p><br /></p><p>Rating &amp; Reviews: {review_summary}</p><p>🆓🚚 Free UK tracked next day delivery on orders over £250 / Free EU tracked 2 - 4 days delivery on orders over €300!</p><p>⏰ Place your order before 2:00 PM Monday - Friday, and we'll dispatch it on the same day! All orders placed after 2:00 PM will be dispatched on the next business day.</p><p><br /></p><p>﹎﹎﹎﹎﹎﹎﹎</p><p>Start with Help! /userguide 📘.</p><p>Type /menu then click Products (Button) or just type in /products 📦.</p><p>Type /coupons to find discount codes 💰.Happy shopping 🛍️</p><p>﹎﹎﹎﹎﹎﹎﹎</p><p><br /></p><p>Note: For Spain and Portugal we only ship to Mainland and not the islands.</p><p><br /></p><p>Peace and Love ✌️❤️</p><p>X's team ®</p><p>Telegram Support: @Xteam 📢</p><p>Instagram: @Xteam (https://www.instagram.com/xxx/) 📸</p>`,
                videoUrl: null,
                parentSectionId: null,
              },
            ];

            for (const sec of defaultSections) {
              const id = uuidv4();
              await pool.query(
                `INSERT INTO sections(id, "organizationId", "parentSectionId", name, title, content, "videoUrl", "createdAt", "updatedAt")
                 VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
                [
                  id,
                  organization.id,
                  sec.parentSectionId,
                  sec.name,
                  sec.title,
                  sec.content,
                  sec.videoUrl,
                  new Date(),
                  new Date(),
                ]
              );
            }

            console.log(
              `[afterCreate] Seeded ${defaultSections.length} default sections for org:`,
              organization.id
            );
          } catch (err) {
            console.error("[afterCreate] Error storing initial data:", err);
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
