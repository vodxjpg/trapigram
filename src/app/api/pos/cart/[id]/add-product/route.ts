export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { pgPool as pool } from "@/lib/db";
import { getContext } from "@/lib/context";
import crypto from "crypto";
import { resolveUnitPrice } from "@/lib/pricing";
import { adjustStock } from "@/lib/stock";
import { emitCartToDisplay } from "@/lib/customer-display-emit";

/* ─────────────────────────────────────────────────────────────
   Tiny TTL cache for base prices (per runtime)
  ───────────────────────────────────────────────────────────── */
type PriceKey = `${string}|${string}|${string}|${string}|${string}`; // org|product|variation|null|country|level
const PRICE_TTL_MS = 60_000;
const priceCache = new Map<PriceKey, { at: number; price: number; isAffiliate: boolean }>();
function priceKey(org: string, p: string, v: string|null, c: string, lvl: string): PriceKey {
  return `${org}|${p}|${v ?? "-"}|${c}|${lvl}` as PriceKey;
}

const STORE_TTL_MS = 5 * 60_000; // 5 min
const storeCountryCache = new Map<string, { at: number; country: string | null }>();
async function getStoreCountryCached(storeId: string, organizationId: string): Promise<string | null> {
  const now = Date.now();
  const key = `${organizationId}:${storeId}`;
  const hit = storeCountryCache.get(key);
  if (hit && now - hit.at < STORE_TTL_MS) return hit.country;

  const { rows } = await pool.query(
    `SELECT address FROM stores WHERE id=$1 AND "organizationId"=$2`,
    [storeId, organizationId],
  );
  let country: string | null = null;
  try {
    const addr = typeof rows[0]?.address === "string" ? JSON.parse(rows[0].address) : rows[0]?.address;
    if (addr?.country && typeof addr.country === "string") country = String(addr.country).toUpperCase();
  } catch {}
  storeCountryCache.set(key, { at: now, country });
  return country;
}

const BodySchema = z.object({
  productId: z.string(),
  variationId: z.string().nullable().optional(),
  quantity: z.number().int().positive(),
});

const BASE_HEADERS: Record<string, string> = {
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
  "X-Content-Type-Options": "nosniff",
};

// channel: "pos-<storeId>-<registerId>"
function parseStoreIdFromChannel(channel: string | null): string | null {
  if (!channel) return null;
  const m = /^pos-([^-\s]+)-/i.exec(channel);
  return m ? m[1] : null;
}

/** Optional idempotency (kept from your original). For pure POS you can drop this. */
async function withIdempotency(
  req: NextRequest,
  exec: () => Promise<{ status: number; body: any; headers?: Record<string,string> }>
): Promise<NextResponse> {
  const key = req.headers.get("Idempotency-Key");
  if (!key) {
    const r = await exec();
    return NextResponse.json(r.body, { status: r.status, headers: { ...BASE_HEADERS, ...(r.headers ?? {}) } });
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
        const { rows } = await c.query(`SELECT status, response FROM idempotency WHERE key=$1`, [key]);
        await c.query("COMMIT");
        if (rows[0]) return NextResponse.json(rows[0].response, { status: rows[0].status, headers: BASE_HEADERS });
        return NextResponse.json({ error: "Idempotency replay but no record" }, { status: 409, headers: BASE_HEADERS });
      }
      if (e?.code === "42P01") {
        await c.query("ROLLBACK");
        const r = await exec();
        return NextResponse.json(r.body, { status: r.status, headers: { ...BASE_HEADERS, ...(r.headers ?? {}) } });
      }
      throw e;
    }
    const r = await exec();
    await c.query(
      `UPDATE idempotency SET status=$2, response=$3, "updatedAt"=NOW() WHERE key=$1`,
      [key, r.status, r.body]
    );
    await c.query("COMMIT");
    return NextResponse.json(r.body, { status: r.status, headers: { ...BASE_HEADERS, ...(r.headers ?? {}) } });
  } catch (err) {
    await c.query("ROLLBACK"); throw err;
  } finally { c.release(); }
}

/* ───────────────────────────────────────────────────────────── */

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;

  return withIdempotency(req, async () => {
    const t0 = Date.now();
    const { organizationId } = ctx as { organizationId: string };
    const { id: cartId } = await params;
    const url = new URL(req.url);
    const wantSnapshot = url.searchParams.get("snapshot") === "1";

    // Parse
    const body = BodySchema.parse(await req.json());
    const variationId = body.variationId && body.variationId.trim() ? body.variationId : null;

    // Cart context
    const { rows: cRows } = await pool.query(
      `SELECT ca.country, ca.channel, cl."levelId", cl.id AS "clientId"
         FROM carts ca
         JOIN clients cl ON cl.id = ca."clientId"
        WHERE ca.id = $1`,
      [cartId]
    );
    if (!cRows.length) return { status: 404, body: { error: "Cart or client not found" } };

    let country: string = cRows[0].country;
    const channel: string | null = cRows[0].channel ?? null;
    const levelId: string = (cRows[0].levelId ?? "default") as string;
    const clientId: string = cRows[0].clientId;

    // Fallback to store country if needed
    const storeId = parseStoreIdFromChannel(channel);
    const storeCountry = storeId ? await getStoreCountryCached(storeId, organizationId) : null;

    // Resolve base price (with tiny TTL cache)
    async function resolveBase(): Promise<{ price: number; isAffiliate: boolean; usedCountry: string }> {
      const key = priceKey(organizationId, body.productId, variationId, country, levelId);
      const hit = priceCache.get(key);
      const now = Date.now();
      if (hit && now - hit.at < PRICE_TTL_MS) return { price: hit.price, isAffiliate: hit.isAffiliate, usedCountry: country };

      try {
        const r = await resolveUnitPrice(body.productId, variationId, country, levelId);
        priceCache.set(key, { at: now, price: r.price, isAffiliate: r.isAffiliate });
        return { price: r.price, isAffiliate: r.isAffiliate, usedCountry: country };
      } catch (e) {
        if (storeCountry && storeCountry !== country) {
          const r2 = await resolveUnitPrice(body.productId, variationId, storeCountry, levelId);
          // Persist effective country for this cart so later calls are consistent
          await pool.query(`UPDATE carts SET country=$1 WHERE id=$2`, [storeCountry, cartId]);
          const k2 = priceKey(organizationId, body.productId, variationId, storeCountry, levelId);
          priceCache.set(k2, { at: now, price: r2.price, isAffiliate: r2.isAffiliate });
          return { price: r2.price, isAffiliate: r2.isAffiliate, usedCountry: storeCountry };
        }
        throw e;
      }
    }

    const { price: basePrice, isAffiliate, usedCountry } = await resolveBase();

    // TX
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // Affiliate points debit (kept as-is)
      if (isAffiliate) {
        const pointsNeeded = basePrice * body.quantity;
        const { rows: bal } = await client.query(
          `SELECT "pointsCurrent" FROM "affiliatePointBalances"
            WHERE "organizationId"=$1 AND "clientId"=$2`,
          [organizationId, clientId],
        );
        const current = Number(bal[0]?.pointsCurrent ?? 0);
        if (pointsNeeded > current) {
          await client.query("ROLLBACK");
          return { status: 400, body: { error: "Insufficient affiliate points", required: pointsNeeded, available: current } };
        }
        await client.query(
          `UPDATE "affiliatePointBalances"
              SET "pointsCurrent"="pointsCurrent"-$1,
                  "pointsSpent"  ="pointsSpent"  +$1,
                  "updatedAt"=NOW()
            WHERE "organizationId"=$2 AND "clientId"=$3`,
          [pointsNeeded, organizationId, clientId],
        );
        await client.query(
          `INSERT INTO "affiliatePointLogs"
             (id,"organizationId","clientId",points,action,description,"createdAt","updatedAt")
           VALUES (gen_random_uuid(),$1,$2,$3,'redeem','add to cart',NOW(),NOW())`,
          [organizationId, clientId, -pointsNeeded],
        );
      }

      // Single UPSERT (no pre-read). Requires the two unique indexes above.
      const upsertSql = `
        INSERT INTO "cartProducts"
          ("cartId","productId","affiliateProductId","variationId",quantity,"unitPrice","createdAt","updatedAt")
        VALUES ($1,$2,$3,$4,$5,$6,NOW(),NOW())
        ON CONFLICT ON CONSTRAINT ${isAffiliate ? "cartprod_uq_aff" : "cartprod_uq_normal"}
        DO UPDATE SET
          quantity   = "cartProducts".quantity + EXCLUDED.quantity,
          "unitPrice"= EXCLUDED."unitPrice",
          "updatedAt"= NOW()
        RETURNING id, quantity, "unitPrice","variationId"
      `;
      const { rows: up } = await client.query(upsertSql, [
        cartId,
        isAffiliate ? null : body.productId,
        isAffiliate ? body.productId : null,
        variationId,
        body.quantity,
        basePrice
      ]);
      const line = up[0];

      // Stock adjust (make your adjustStock atomic to remove any pre-checks elsewhere)
      await adjustStock(client, body.productId, variationId, usedCountry, -body.quantity);

      await client.query("COMMIT");

      // Emit to paired customer display (fire-and-forget)
      try { setTimeout(() => { emitCartToDisplay(cartId).catch(() => {}); }, 0); } catch {}

      // Totals/hash: read fast counters if present; fallback to aggregate if migration not applied yet.
      let totals: { lineCount: number; quantity: number; value: number; cartHash: string };
      try {
        const { rows: one } = await pool.query(
          `SELECT line_count, qty_sum, val_sum, "cartUpdatedHash" FROM carts WHERE id = $1`,
          [cartId]
        );
        totals = {
          lineCount: Number(one[0].line_count ?? 0),
          quantity: Number(one[0].qty_sum ?? 0),
          value: Number(one[0].val_sum ?? 0),
          cartHash: String(one[0].cartUpdatedHash ?? "")
        };
      } catch (e: any) {
        // Columns not there yet → fallback once (slower)
        const { rows: hv } = await pool.query(
          `SELECT COUNT(*)::int AS n,
                  COALESCE(SUM(quantity),0)::int AS q,
                  COALESCE(SUM((quantity * "unitPrice")::numeric),0)::text AS v
             FROM "cartProducts"
            WHERE "cartId"=$1`,
          [cartId]
        );
        const cartHash = crypto.createHash("sha256")
          .update(`${hv[0].n}|${hv[0].q}|${hv[0].v}`)
          .digest("hex");
        totals = { lineCount: hv[0].n, quantity: hv[0].q, value: Number(hv[0].v), cartHash };
      }

      // Optional: heavy snapshot for UI (opt-in)
      if (wantSnapshot) {
        const { rows: snap } = await pool.query(
          `SELECT 
             p.id                            AS pid,
             p.title                         AS parent_title,
             p.image                         AS parent_image,
             p.sku                           AS parent_sku,
             v.attributes                    AS var_attributes,
             v.image                         AS var_image,
             v.sku                           AS var_sku,
             cp.quantity,
             cp."unitPrice",
             cp."variationId",
             false                           AS "isAffiliate",
             cp."createdAt"                  AS created_at
           FROM "cartProducts" cp
           JOIN products p            ON cp."productId" = p.id
           LEFT JOIN "productVariations" v ON v.id = cp."variationId"
           WHERE cp."cartId"=$1

           UNION ALL

           SELECT 
             ap.id                           AS pid,
             ap.title                        AS parent_title,
             ap.image                        AS parent_image,
             ap.sku                          AS parent_sku,
             NULL::jsonb                     AS var_attributes,
             NULL::text                      AS var_image,
             NULL::text                      AS var_sku,
             cp.quantity,
             cp."unitPrice",
             cp."variationId",
             true                            AS "isAffiliate",
             cp."createdAt"                  AS created_at
           FROM "cartProducts" cp
           JOIN "affiliateProducts" ap ON cp."affiliateProductId"=ap.id
           WHERE cp."cartId"=$1

           ORDER BY created_at`,
          [cartId]
        );

        return {
          status: 201,
          body: {
            changedLine: {
              productId: body.productId,
              variationId,
              isAffiliate,
              unitPrice: Number(line.unitPrice),
              deltaQuantity: body.quantity,
              newQuantity: Number(line.quantity)
            },
            totals,
            lines: snap.map((r: any) => ({
              id: r.pid,
              title: r.isAffiliate ? r.parent_title : r.parent_title, // keep as-is; UI already formats
              image: r.isAffiliate ? r.parent_image : (r.var_image ?? r.parent_image ?? null),
              sku: r.isAffiliate ? (r.parent_sku ?? null) : (r.var_sku ?? r.parent_sku ?? null),
              quantity: Number(r.quantity),
              unitPrice: Number(r.unitPrice),
              variationId: r.variationId,
              isAffiliate: r.isAffiliate,
              subtotal: Number(r.unitPrice) * Number(r.quantity),
            }))
          },
          headers: BASE_HEADERS
        };
      }

      // Fast (default) minimal payload: delta + totals
      return {
        status: 201,
        body: {
          changedLine: {
            productId: body.productId,
            variationId,
            isAffiliate,
            unitPrice: Number(line.unitPrice),
            deltaQuantity: body.quantity,
            newQuantity: Number(line.quantity)
          },
          totals
        },
        headers: BASE_HEADERS
      };
    } catch (err: any) {
      try { await client.query("ROLLBACK"); } catch {}
      if (err?.code === "23505") return { status: 409, body: { error: "Conflict" }, headers: BASE_HEADERS };
      if (err instanceof z.ZodError) return { status: 400, body: { error: err.errors }, headers: BASE_HEADERS };
      if (typeof err?.message === "string" && err.message.startsWith("No money price for")) {
        return { status: 400, body: { error: err.message }, headers: BASE_HEADERS };
      }
      console.error("[POS POST /pos/cart/:id/add-product][fast]", err);
      return { status: 500, body: { error: "Internal server error" }, headers: BASE_HEADERS };
    } finally {
      try { client.release(); } catch {}
    }
  });
}
