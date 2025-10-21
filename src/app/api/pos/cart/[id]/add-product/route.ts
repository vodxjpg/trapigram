// src/app/api/pos/cart/[id]/add-product/route.ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { pgPool as pool } from "@/lib/db";
import { getContext } from "@/lib/context";
import { v4 as uuidv4 } from "uuid";
import crypto from "crypto";
import { resolveUnitPrice } from "@/lib/pricing";
import { adjustStock } from "@/lib/stock";
import { tierPricing, getPriceForQuantity, type Tier } from "@/lib/tier-pricing";
import { emitCartToDisplay } from "@/lib/customer-display-emit";

/* ─────────────────────────────────────────────────────────────
   Small in-memory caches (per runtime)
  ───────────────────────────────────────────────────────────── */
const TIER_TTL_MS = 20_000;       // 20s – fresh enough for POS
const STORE_TTL_MS = 5 * 60_000;  // 5 min

const tierCache = new Map<string, { at: number; data: Tier[] }>();
async function getTiersCached(orgId: string): Promise<Tier[]> {
  const now = Date.now();
  const hit = tierCache.get(orgId);
  if (hit && now - hit.at < TIER_TTL_MS) return hit.data;
  const data = (await tierPricing(orgId)) as Tier[];
  tierCache.set(orgId, { at: now, data });
  return data;
}

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
  } catch { /* noop */ }

  storeCountryCache.set(key, { at: now, country });
  return country;
}

/* ───────────────────────────────────────────────────────────── */

type ExecResult = { status: number; body: any; headers?: Record<string, string> };

async function withIdempotency(
  req: NextRequest,
  exec: () => Promise<ExecResult>
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
        const { rows } = await c.query(
          `SELECT status, response FROM idempotency WHERE key=$1`,
          [key]
        );
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

/* ───────────────────────────────────────────────────────────── */

const BodySchema = z.object({
  productId: z.string(),
  variationId: z.string().nullable().optional(),
  quantity: z.number().int().positive(),
});

// helper to parse storeId from channel: "pos-<storeId>-<registerId>"
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

/** Inventory reader aligned with your schema.
 *  - products: uses "manageStock" + "allowBackorders" (plural)
 *  - no stock quantity column on products → stock=null (no hard cap)
 *  - variations: try to read same-named columns if table/cols exist
 *    (safeQuery swallows 42P01/42703 so we don’t crash)
 */
async function readInventoryFast(
  client: any,
  productId: string,
  variationId: string | null
): Promise<{ manage: boolean; backorder: boolean; stock: number | null }> {
  const safeQuery = async (sql: string, params: any[], sp: string) => {
    await client.query(`SAVEPOINT ${sp}`);
    try {
      const r = await client.query(sql, params);
      await client.query(`RELEASE SAVEPOINT ${sp}`);
      return r;
    } catch (e: any) {
      await client.query(`ROLLBACK TO SAVEPOINT ${sp}`);
      // 42703 = undefined_column, 42P01 = undefined_table
      if (e?.code === "42703" || e?.code === "42P01") return { rows: [] };
      throw e;
    }
  };

  // Products row (matches your schema)
  const p = await safeQuery(
    `SELECT
       COALESCE("manageStock", false)     AS manage,
       COALESCE("allowBackorders", false) AS backorder
     FROM products
     WHERE id=$1
     LIMIT 1`,
    [productId],
    "inv_p"
  );

  let manage = !!p.rows?.[0]?.manage;
  let backorder = !!p.rows?.[0]?.backorder;
  let stock: number | null = null; // no quantity column on products

  // Variation overrides (use same column names if present)
  if (variationId) {
    const v = await safeQuery(
      `SELECT
         COALESCE("manageStock", false)     AS manage,
         COALESCE("allowBackorders", false) AS backorder,
         NULL::int                           AS stock
       FROM "productVariations"
       WHERE id=$1
       LIMIT 1`,
      [variationId],
      "inv_v"
    );
    if (v.rows?.[0]) {
      manage = !!v.rows[0].manage || manage;
      if (v.rows[0].backorder != null) backorder = !!v.rows[0].backorder;
      // if your variations have a qty column, you can map it here instead of NULL::int
      // stock remains null by default → no hard cap enforcement
    }
  }

  return { manage, backorder, stock };
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;

  return withIdempotency(req, async (): Promise<ExecResult> => {
    const T0 = Date.now();
    const marks: Array<[string, number]> = [];
    const mark = (label: string) => marks.push([label, Date.now() - T0]);

    let client: any | null = null;

    try {
      const { id: cartId } = await params;
      const body = BodySchema.parse(await req.json());
      mark("parsed_body");

      const variationId =
        typeof body.variationId === "string" && body.variationId.trim().length > 0
          ? body.variationId
          : null;

      // cart context
      const { rows: cRows } = await pool.query(
        `SELECT ca.country, ca.channel, cl."levelId", cl.id AS "clientId"
           FROM carts ca
           JOIN clients cl ON cl.id = ca."clientId"
          WHERE ca.id = $1`,
        [cartId]
      );
      mark("cart_lookup");
      if (!cRows.length) return { status: 404, body: { error: "Cart or client not found" } };

      const organizationId: string = (ctx as any).organizationId;
      let country: string = cRows[0].country;
      const channel: string | null = cRows[0].channel ?? null;
      const levelId: string | null = cRows[0].levelId ?? null;
      const clientId: string = cRows[0].clientId;

      // store country (cached)
      let storeCountry: string | null = null;
      const storeId = parseStoreIdFromChannel(channel);
      if (storeId) {
        storeCountry = await getStoreCountryCached(storeId, organizationId);
        mark("store_lookup");
      }

      // price (fallback to store country once)
      let basePrice: number, isAffiliate: boolean;
      try {
        const r = await resolveUnitPrice(body.productId, variationId, country, (levelId ?? "default") as string);
        basePrice = r.price; isAffiliate = r.isAffiliate;
        mark("resolve_price");
      } catch (e: any) {
        if (storeCountry && storeCountry !== country) {
          const r2 = await resolveUnitPrice(body.productId, variationId, storeCountry, (levelId ?? "default") as string);
          basePrice = r2.price; isAffiliate = r2.isAffiliate;
          country = storeCountry;
          await pool.query(`UPDATE carts SET country=$1 WHERE id=$2`, [country, cartId]);
          mark("resolve_price_store_country");
        } else {
          throw e;
        }
      }

      client = await pool.connect();
      await client.query("BEGIN");
      mark("tx_begin");

      // existing line
      let sql = `SELECT id, quantity FROM "cartProducts"
                 WHERE "cartId"=$1 AND ${isAffiliate ? `"affiliateProductId"` : `"productId"`}=$2`;
      const paramsLine: any[] = [cartId, body.productId];
      if (variationId) { sql += ` AND "variationId"=$3`; paramsLine.push(variationId); }
      const { rows: existing } = await client.query(sql, paramsLine);
      mark("line_lookup");

      // inventory guard (normal only; only enforces if a numeric stock exists)
      if (!isAffiliate) {
        const inv = await readInventoryFast(client, body.productId, variationId);
        mark("read_inventory");
        const newQty = (existing[0]?.quantity ?? 0) + body.quantity;
        if (inv.manage && !inv.backorder && inv.stock !== null && newQty > inv.stock) {
          await client.query("ROLLBACK");
          return {
            status: 400,
            body: { error: `Only ${inv.stock} unit${inv.stock === 1 ? "" : "s"} available for this item.`, available: inv.stock },
          };
        }
      }

      // affiliate points flow
      if (isAffiliate) {
        const pointsNeeded = basePrice * body.quantity;
        const { rows: bal } = await client.query(
          `SELECT "pointsCurrent" FROM "affiliatePointBalances"
            WHERE "organizationId"=$1 AND "clientId"=$2`,
          [organizationId, clientId],
        );
        mark("affiliate_balance_lookup");

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
        mark("affiliate_debit");
      }

      // upsert line + tier price (normal only)
      let quantity = body.quantity + (existing[0]?.quantity ?? 0);
      let unitPrice = basePrice;

      if (!isAffiliate) {
        const tiers = await getTiersCached(organizationId);
        mark("tier_load");

        const tier = pickTierForClient(tiers, country, body.productId, variationId, clientId);
        if (tier) {
          const tierProdIds = tier.products.map((p) => p.productId).filter(Boolean) as string[];
          const tierVarIds = tier.products.map((p) => p.variationId).filter(Boolean) as string[];
          const { rows: sumRow } = await client.query(
            `SELECT COALESCE(SUM(quantity),0)::int AS qty
               FROM "cartProducts"
              WHERE "cartId"=$1
                AND ( ("productId" = ANY($2::text[]))
                      OR ("variationId" IS NOT NULL AND "variationId" = ANY($3::text[])) )`,
            [cartId, tierProdIds, tierVarIds],
          );
          mark("tier_qty_sum");

          const qtyBefore = Number(sumRow[0].qty);
          const qtyAfter = qtyBefore - (existing[0]?.quantity ?? 0) + quantity;
          const tierPrice = getPriceForQuantity(tier.steps, qtyAfter);
          if (tierPrice != null && tierPrice !== basePrice) {
            unitPrice = tierPrice;
            await client.query(
              `UPDATE "cartProducts"
                  SET "unitPrice"=$1,"updatedAt"=NOW()
                WHERE "cartId"=$2
                  AND ( ("productId" = ANY($3::text[]))
                        OR ("variationId" IS NOT NULL AND "variationId" = ANY($4::text[])) )`,
              [unitPrice, cartId, tierProdIds, tierVarIds]
            );
            mark("tier_update_lines");
          }
        }
      }

      if (existing.length) {
        await client.query(
          `UPDATE "cartProducts"
              SET quantity=$1,"unitPrice"=$2,"updatedAt"=NOW()
            WHERE id=$3`,
          [quantity, unitPrice, existing[0].id]
        );
      } else {
        if (variationId) {
          await client.query(
            `INSERT INTO "cartProducts"
               (id,"cartId","productId","affiliateProductId","variationId",quantity,"unitPrice","createdAt","updatedAt")
             VALUES ($1,$2,$3,$4,$5,$6,$7,NOW(),NOW())`,
            [uuidv4(), cartId, isAffiliate ? null : body.productId, isAffiliate ? body.productId : null, variationId, quantity, unitPrice]
          );
        } else {
          await client.query(
            `INSERT INTO "cartProducts"
               (id,"cartId","productId","affiliateProductId",quantity,"unitPrice","createdAt","updatedAt")
             VALUES ($1,$2,$3,$4,$5,$6,NOW(),NOW())`,
            [uuidv4(), cartId, isAffiliate ? null : body.productId, isAffiliate ? body.productId : null, quantity, unitPrice]
          );
        }
      }
      mark("upsert_line");

      // stock adjust
      await adjustStock(client, body.productId, variationId, country, -body.quantity);
      mark("adjust_stock");

      // cart hash
      const { rows: hRows } = await client.query(
        `SELECT COALESCE("productId","affiliateProductId") AS pid, "variationId", quantity,"unitPrice"
           FROM "cartProducts"
          WHERE "cartId"=$1
          ORDER BY pid, "variationId" NULLS FIRST`,
        [cartId]
      );
      const hash = crypto.createHash("sha256").update(JSON.stringify(hRows)).digest("hex");
      await client.query(
        `UPDATE carts SET "cartUpdatedHash"=$1,"updatedAt"=NOW() WHERE id=$2`,
        [hash, cartId]
      );
      mark("hash_update");

      await client.query("COMMIT");
      mark("tx_commit");

      // fire-and-forget
      try { queueMicrotask(() => { emitCartToDisplay(cartId).catch(e => console.warn("[cd][add] emit failed", e)); }); } catch {}
      mark("emit_display_sched");

      const totalMs = Date.now() - T0;
      const serverTiming = marks.map(([l, d], i) => `m${i};desc="${l}";dur=${d}`).join(", ");

      return {
        status: 201,
        body: { ok: true, quantity, price: unitPrice },
        headers: { "Server-Timing": serverTiming, "X-Route-Duration": `${totalMs}ms` },
      };
    } catch (err: any) {
      try { if (client) await client.query("ROLLBACK"); } catch {}
      if (err instanceof z.ZodError) return { status: 400, body: { error: err.errors } };
      if (typeof err?.message === "string" && err.message.startsWith("No money price for")) {
        return { status: 400, body: { error: err.message } };
      }
      console.error("[POS POST /pos/cart/:id/add-product]", err);
      return { status: 500, body: { error: err.message ?? "Internal server error" } };
    } finally {
      try { if (client) client.release(); } catch {}
    }
  });
}
