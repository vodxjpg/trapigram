// src/lib/plugins/subscription-plugin.ts
import { BetterAuthPlugin } from "better-auth";
import { createAuthEndpoint } from "better-auth/api";
import { plans } from "@/data/plans";
import { pgPool as pool } from "@/lib/db";;
import { v4 as uuidv4 } from "uuid";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

export const subscriptionPlugin = (): BetterAuthPlugin => {
  return {
    id: "subscription",
    schema: {
      subscription: {
        fields: {
          userId: {
            type: "string",
            reference: { model: "user", field: "id", onDelete: "cascade" },
          },
          plan: { type: "string" },
          status: { type: "string" },
          trialStart: { type: "date" },
          trialEnd: { type: "date" },
          periodStart: { type: "date" },
          periodEnd: { type: "date" },
        },
      },
    },
    endpoints: {
      createSubscription: createAuthEndpoint(
        "/subscription/create",
        { method: "POST" },
        async (ctx) => {
          const { userId, plan } = ctx.body;
          const selectedPlan = plans.find((p) => p.name === plan);
          if (!selectedPlan) {
            throw new Error("Invalid plan");
          }
          const now = new Date();
          const trialEnd = new Date(now);
          trialEnd.setDate(now.getDate() + 365);

          // Generate and include UUID for the subscription id
          const id = uuidv4();

          const { rows } = await pool.query(
            `INSERT INTO subscription (
               id,
               "userId",
               plan,
               status,
               "trialStart",
               "trialEnd",
               "periodStart",
               "periodEnd"
             )
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             RETURNING *`,
            [
              id,
              userId,
              selectedPlan.name,
              "trialing",
              now,
              trialEnd,
              now,
              trialEnd,
            ]
          );
          return ctx.json({ subscription: rows[0] });
        }
      ),
      status: createAuthEndpoint(
        "/subscription/status",
        { method: "GET" },
        async (ctx) => {
          console.log("Hit status endpoint");
          const userId = ctx.query.userId as string;
          if (!userId) {
            throw new Error("User ID is required");
          }
          const { rows } = await pool.query(
            `SELECT * FROM subscription
             WHERE "userId" = $1 AND (status = 'trialing' OR status = 'active')`,
            [userId]
          );
          const now = new Date();
          const hasActiveSubscription = rows.some((sub) => {
            const trialEnd = sub.trialEnd ? new Date(sub.trialEnd) : null;
            const periodEnd = sub.periodEnd ? new Date(sub.periodEnd) : null;
            return (
              (sub.status === "trialing" || sub.status === "active") &&
              (trialEnd ? trialEnd > now : true) &&
              (periodEnd ? periodEnd > now : true)
            );
          });
          console.log("Returning subscription status:", { hasActiveSubscription });
          return ctx.json({ hasActiveSubscription });
        }
      ),
    },
  };
};
