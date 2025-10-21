import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { pgPool as pool } from "@/lib/db";
import crypto from "crypto";
import { getContext } from "@/lib/context";
import { adjustStock } from "@/lib/stock";
import { tierPricing, getPriceForQuantity, type Tier } from "@/lib/tier-pricing";
import { resolveUnitPrice } from "@/lib/pricing";
import { emitCartToDisplay } from "@/lib/customer-display-emit";

/* small tier cache, shared with add-product if both run in same process */
const tierCache = new Map<string, { ts: number; tiers: Tier[] }>();
const TIER_TTL = 60_000;
async function getTiersCached(orgId: string) {
  const hit = tierCache.get(orgId);
  const now = Date.now();
  if (hit && now - hit.ts < TIER_TTL) return hit.tiers;
  const tiers = (await tierPricing(orgId)) as Tier[];
  tierCache.set(orgId, { ts: now, tiers });
  return tiers;
}

/** Idempotency helper */
async function withIdempotency(
  req: NextRequest,
  exec: () => Promise<{ status: number; body: any; headers?: Record<string,string> }>
): Promise<NextResponse> {
  const key = req.headers.get("Idempotency-Key");
  if (!key) {
    const r = await exec();
    return NextResponse.json(r.body, { status: r.status, headers: r.headers });
  }
  const method = req.method;
  const path = new URL(req.url).pathname;
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    try {
      await c.query(
        `INSERT INTO idempotency(key, method, path, "createdAt") VALUES ($1,$2,$3,NOW())`,
        [key, method, path]
      );
    } catch (e: any) {
      if (e?.code === "23505") {
        const { rows } = await c.query(`SELECT status, response FROM idempotency WHERE key = $1`, [key]);
        await c.query("COMMIT");
        if (rows[0]) return NextResponse.json(rows[0].response, { status: rows[0].status });
        return NextResponse.json({ error: "Idempotency replay but no record" }, { status: 409 });
      }
      if (e?.code === "42P01") {
        await c.query("ROLLBACK");
        const r = await exec();
        return NextResponse.json(r.body, { status: r.status, headers: r.headers });
      }
      throw e;
    }
    const r = await exec();
    await c.query(
      `UPDATE idempotency SET status=$2, response=$3, "updatedAt"=NOW() WHERE key=$1`,
      [key, r.status, r.body]
    );
    await c.query("COMMIT");
    return NextResponse.json(r.body, { status: r.status, headers: r.headers });
  } catch (err) {
    await c.query("ROLLBACK");
    throw err;
  } finally {
    c.release();
  }
}

const BodySchema = z.object({
  productId: z.string(),
  variationId: z.string().nullable().optional(),
});

function parseStoreIdFromChannel(channel: string | null): string | null {
  if (!channel) return null;
  const m = /^pos-([^-\s]+)-/i.exec(channel);
  return m ? m[1] : null;
}

function pickTierForClient(
  tiers: Tier[],
  country: string,
  productId: string,
  variationId: string | null,
  clientId?: string | null,
): Tier | null {
  const CC = (country || "").toUpperCase();
  const inTier = (t: Tier) =>
    t.active === true &&
    t.countries.some((c) => (c || "").toUpperCase() === CC) &&
    t.products.some(
      (p) =>
        (p.productId && p.productId === productId) ||
        (!!variationId && p.variationId === variationId),
    );
  const candidates = tiers.filter(inTier);
  if (!candidates.length) return null;

  const targets = (t: Tier): string[] =>
    ((((t as any).clients as string[] | undefined) ??
      ((t as any).customers as string[] | undefined) ??
      []) as string[]).filter(Boolean);

  if (clientId) {
    const targeted = candidates.find((t) => targets(t).includes(clientId));
    if (targeted) return targeted;
  }
  const global = candidates.find((t) => targets(t).length === 0);
  return global ?? null;
}

async function computeCartHash(cartId: string): Promise<string> {
  const { rows } = await pool.query(
    `SELECT COALESCE("productId","affiliateProductId") AS pid,
            "variationId", quantity,"unitPrice"
       FROM "cartProducts"
      WHERE "cartId" = $1
      ORDER BY "createdAt"`,
    [cartId],
  );
  return crypto.createHash("sha256").update(JSON.stringify(rows ?? [])).digest("hex");
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;

  return withIdempotency(req, async () => {
    const T0 = Date.now();
    const marks: Array<[string, number]> = [];
    const mark = (l: string) => marks.push([l, Date.now() - T0]);

    try {
      const { id: cartId } = await params;
      // body or query params
      let parsed: z.infer<typeof BodySchema>;
      try {
        const body = await req.json().catch(() => ({}));
        parsed = BodySchema.parse(body);
      } catch {
        const url = new URL(req.url);
        parsed = BodySchema.parse({
          productId: url.searchParams.get("productId"),
          variationId: url.searchParams.get("variationId"),
        });
      }

      const normVariationId =
        typeof parsed.variationId === "string" && parsed.variationId.trim().length > 0
          ? parsed.variationId
          : null;
      const withVariation = normVariationId !== null;

      const result = await pool.query(
        `DELETE FROM "cartProducts"
          WHERE "cartId"=$1 AND ("productId"=$2 OR "affiliateProductId"=$2)
          ${withVariation ? `AND "variationId"=$3` : ""}
          RETURNING *`,
        [cartId, parsed.productId, ...(withVariation ? [normVariationId] : [])]
      );
      mark("delete_line");

      const deleted = result.rows[0];
      if (!deleted) return { status: 404, body: { error: "Cart line not found" } };

      // Context for stock + tier recompute
      const { rows: cRows } = await pool.query(
        `SELECT ca.country, ca.channel, cl."levelId", ca."clientId"
           FROM carts ca
           JOIN clients cl ON cl.id = ca."clientId"
          WHERE ca.id = $1`,
        [cartId]
      );
      mark("cart_ctx");

      let country = cRows[0]?.country as string | undefined;
      const levelId = cRows[0]?.levelId as string | undefined;
      const clientId = cRows[0]?.clientId as string | undefined;
      const channel = cRows[0]?.channel as string | undefined;

      // Refund affiliate points if needed
      if (deleted.affiliateProductId && clientId) {
        const qty = Number(deleted.quantity ?? 0);
        const unitPts = Number(deleted.unitPrice ?? 0);
        const pointsRefund = qty > 0 && unitPts > 0 ? qty * unitPts : 0;
        if (pointsRefund > 0) {
          await pool.query(
            `UPDATE "affiliatePointBalances"
                SET "pointsCurrent" = "pointsCurrent" + $1,
                    "pointsSpent"   = GREATEST("pointsSpent" - $1, 0),
                    "updatedAt"     = NOW()
              WHERE "organizationId" = $2
                AND "clientId"      = $3`,
            [pointsRefund, ctx.organizationId, clientId],
          );
          await pool.query(
            `INSERT INTO "affiliatePointLogs"
               (id,"organizationId","clientId",points,action,description,"createdAt","updatedAt")
             VALUES (gen_random_uuid(),$1,$2,$3,'refund','remove from pos cart',NOW(),NOW())`,
            [ctx.organizationId, clientId, pointsRefund],
          );
        }
        mark("affiliate_refund");
      }

      // Derive store country from channel
      let storeCountry: string | null = null;
      const storeId = parseStoreIdFromChannel(channel ?? null);
      if (storeId) {
        const { rows: sRows } = await pool.query(
          `SELECT address FROM stores WHERE id=$1 AND "organizationId"=$2`,
          [storeId, ctx.organizationId]
        );
        if (sRows[0]?.address) {
          try {
            const addr = typeof sRows[0].address === "string" ? JSON.parse(sRows[0].address) : sRows[0].address;
            if (addr?.country) storeCountry = String(addr.country).toUpperCase();
          } catch {}
        }
        mark("store_lookup");
      }

      // Release stock ONLY for normal products
      if (!deleted.affiliateProductId) {
        const effCountry = (country ?? storeCountry ?? "US") as string;
        const c = await pool.connect();
        try {
          await adjustStock(c, parsed.productId, normVariationId, effCountry, +Number(deleted.quantity ?? 0));
        } finally {
          c.release();
        }
        country = effCountry;
        mark("release_stock");
      }

      // Tier re-evaluation ONLY for normal products
      if (!deleted.affiliateProductId && country && levelId) {
        const tiers = await getTiersCached(ctx.organizationId);
        const tier = pickTierForClient(tiers, country, deleted.productId, normVariationId, clientId);

        if (tier) {
          const tierProdIds = tier.products.map((p) => p.productId).filter(Boolean) as string[];
          const tierVarIds = tier.products.map((p) => p.variationId).filter(Boolean) as string[];

          const { rows: qRows } = await pool.query(
            `SELECT COALESCE(SUM(quantity),0)::int AS qty
               FROM "cartProducts"
              WHERE "cartId" = $1
                AND ( ("productId" = ANY($2::text[]))
                      OR ("variationId" IS NOT NULL AND "variationId" = ANY($3::text[])) )`,
            [cartId, tierProdIds, tierVarIds],
          );
          const qtyAfter = Number(qRows[0]?.qty ?? 0);

          const newUnit = getPriceForQuantity(tier.steps, qtyAfter);

          if (newUnit === null) {
            const { rows: lines } = await pool.query(
              `SELECT id,"productId","variationId"
                 FROM "cartProducts"
                WHERE "cartId" = $1
                  AND ( ("productId" = ANY($2::text[]))
                        OR ("variationId" IS NOT NULL AND "variationId" = ANY($3::text[])) )`,
              [cartId, tierProdIds, tierVarIds],
            );

            for (const line of lines) {
              let effCountry = country as string;
              let price: number;
              try {
                price = (await resolveUnitPrice(
                  line.productId,
                  (typeof line.variationId === "string" && line.variationId.trim().length > 0) ? line.variationId : null,
                  effCountry,
                  levelId as string,
                )).price;
              } catch (e: any) {
                if (storeCountry && storeCountry !== effCountry) {
                  effCountry = storeCountry;
                  price = (await resolveUnitPrice(
                    line.productId,
                    (typeof line.variationId === "string" && line.variationId.trim().length > 0) ? line.variationId : null,
                    effCountry,
                    levelId as string,
                  )).price;
                  await pool.query(`UPDATE carts SET country=$1 WHERE id=$2`, [effCountry, cartId]);
                  country = effCountry;
                } else {
                  throw e;
                }
              }
              await pool.query(
                `UPDATE "cartProducts" SET "unitPrice"=$1, "updatedAt"=NOW() WHERE id=$2`,
                [price, line.id],
              );
            }
          } else {
            await pool.query(
              `UPDATE "cartProducts"
                    SET "unitPrice"=$1, "updatedAt"=NOW()
                  WHERE "cartId" = $2
                    AND ( ("productId" = ANY($3::text[]))
                          OR ("variationId" IS NOT NULL AND "variationId" = ANY($4::text[])) )`,
              [newUnit, cartId, tierProdIds, tierVarIds],
            );
          }
          mark("tier_reprice");
        }
      }

      // Recompute hash
      const newHash = await computeCartHash(cartId);
      await pool.query(
        `UPDATE carts SET "cartUpdatedHash"=$1,"updatedAt"=NOW() WHERE id=$2`,
        [newHash, cartId],
      );
      mark("hash_update");

      try { await emitCartToDisplay(cartId); } catch (e) { console.warn("[cd][remove] emit failed", e); }
      mark("emit_display");

      // Single UNION ALL snapshot
      const { rows: snap } = await pool.query(
        `
        SELECT x.id, x.title, x.description, x.image, x.sku,
               x.quantity, x."unitPrice", x."variationId", x."createdAt", x."isAffiliate"
        FROM (
          SELECT p.id, p.title, p.description, p.image, p.sku,
                 cp.quantity, cp."unitPrice", cp."variationId", cp."createdAt", false AS "isAffiliate"
          FROM "cartProducts" cp
          JOIN products p ON cp."productId" = p.id
          WHERE cp."cartId"=$1
          UNION ALL
          SELECT ap.id, ap.title, ap.description, ap.image, ap.sku,
                 cp.quantity, cp."unitPrice", cp."variationId", cp."createdAt", true AS "isAffiliate"
          FROM "cartProducts" cp
          JOIN "affiliateProducts" ap ON cp."affiliateProductId" = ap.id
          WHERE cp."cartId"=$1
        ) x
        ORDER BY x."createdAt"
        `,
        [cartId]
      );
      mark("snapshot_union");

      const lines = snap.map((l: any) => ({
        ...l,
        unitPrice: Number(l.unitPrice),
        subtotal: Number(l.unitPrice) * Number(l.quantity),
      }));

      const serverTiming = marks.map(([l, d], i) => `m${i};desc="${l}";dur=${d}`).join(", ");
      return { status: 200, body: { lines }, headers: { "Server-Timing": serverTiming } };
    } catch (err: any) {
      console.error("[POS POST /pos/cart/:id/remove-product]", err);
      if (err instanceof z.ZodError) return { status: 400, body: { error: err.errors } };
      return { status: 500, body: { error: err.message ?? "Internal server error" } };
    }
  });
}
