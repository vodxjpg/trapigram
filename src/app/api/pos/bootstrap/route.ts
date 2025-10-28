import { NextRequest, NextResponse } from "next/server";
import { getContext } from "@/lib/context";
import { tierPricing } from "@/lib/tier-pricing";
import { pgPool as pool } from "@/lib/db";

/**
 * Device bootstrap:
 * - active payment methods (POS-visible)
 * - tier rules (for local repricing preview)
 * - store country (if storeId provided), else null
 * - latest exchange rate row (optional hint for UI)
 */
export async function GET(req: NextRequest) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;

  const { tenantId, organizationId } = ctx as { tenantId: string | null; organizationId: string };
  if (!tenantId) return NextResponse.json({ error: "Tenant not found" }, { status: 404 });

  const url = new URL(req.url);
  const storeId = url.searchParams.get("storeId");

  const [tiers, pm, storeRow, fx] = await Promise.all([
    tierPricing(organizationId),
    pool.query(
      `SELECT id, name, active, "default", description, instructions
         FROM "paymentMethods"
        WHERE "tenantId" = $1
          AND active = TRUE
          AND COALESCE("posVisible", TRUE) = TRUE
        ORDER BY "createdAt" DESC`,
      [tenantId]
    ),
    storeId
      ? pool.query(
          `SELECT address FROM stores WHERE id=$1 AND "organizationId"=$2 LIMIT 1`,
          [storeId, organizationId]
        )
      : Promise.resolve({ rows: [] } as any),
    pool.query(`SELECT "EUR","GBP",date FROM "exchangeRate" ORDER BY date DESC LIMIT 1`),
  ]);

  let storeCountry: string | null = null;
  if (storeRow.rows[0]?.address) {
    try {
      const a = typeof storeRow.rows[0].address === "string" ? JSON.parse(storeRow.rows[0].address) : storeRow.rows[0].address;
      if (a?.country) storeCountry = String(a.country).toUpperCase();
    } catch {}
  }

  return NextResponse.json({
    paymentMethods: pm.rows,
    tierRules: tiers,
    storeCountry,
    fxHint: fx.rows[0] ?? null,
  });
}
    