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
const TIER_TTL_MS = 120_000;      // 2 min – good for POS, lowers repeated tier calls
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

/* ─────────────────────────────────────────────────────────────
   Helpers
  ───────────────────────────────────────────────────────────── */

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

const BodySchema = z.object({
  productId: z.string(),
  variationId: z.string().nullable().optional(),
  quantity: z.number().int().positive(),
});

// channel: "pos-<storeId>-<registerId>"
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

/** Inventory check (schema-aware).
 *  productVariations has no stock flags → only read products row.
 */
async function readInventoryFast(
  client: any,
  productId: string,
): Promise<{ manage: boolean; backorder: boolean; stock: number | null }> {
  const { rows } = await client.query(
    `SELECT COALESCE("manageStock", false) AS manage,
            COALESCE("allowBackorders", false) AS backorder
       FROM products
      WHERE id=$1
      LIMIT 1`,
    [productId],
  );
  return {
    manage: !!rows?.[0]?.manage,
    backorder: !!rows?.[0]?.backorder,
    stock: null,
  };
}

/* Variant-title helpers (tolerant of many shapes & filters UUID-looking strings) */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function readLabelish(x: any): string | null {
  if (x == null) return null;
  if (typeof x === "string") return UUID_RE.test(x) ? null : (x.trim() || null);
  if (typeof x === "number" || typeof x === "boolean") return String(x);
  if (typeof x === "object") {
    const keys = ["optionName","valueName","label","name","title","value","text"];
    for (const k of keys) {
      if (x[k] != null) {
        const v = readLabelish(x[k]);
        if (v) return v;
      }
    }
  }
  return null;
}

function labelsFromAttributes(attrs: any): string[] {
  const out: string[] = [];
  const push = (v: string | null) => { if (v && !UUID_RE.test(v)) out.push(v); };

  try {
    if (Array.isArray(attrs)) {
      for (const it of attrs) {
        const v = readLabelish(it?.value) ?? readLabelish(it?.optionName) ?? readLabelish(it);
        push(v);
      }
      return [...new Set(out)];
    }

    if (attrs && typeof attrs === "object") {
      for (const [k, v] of Object.entries(attrs)) {
        const val = readLabelish((v as any)?.value) ?? readLabelish((v as any)?.optionName) ?? readLabelish(v);
        if (val) {
          const keyNice = UUID_RE.test(k) ? null : (k || "").trim();
          push(keyNice ? `${keyNice}: ${val}` : val);
        }
      }
      return [...new Set(out)];
    }

    push(readLabelish(attrs));
    return [...new Set(out)];
  } catch {
    return [];
  }
}

function formatVariationTitle(parentTitle: string, attributes: any): string {
  const labels = labelsFromAttributes(attributes);
  return labels.length ? `${parentTitle} - ${labels.join(" / ")}` : parentTitle;
}

/** Swallow emitter timeouts & errors, never block request */
function withTimeout<T>(p: Promise<T>, ms: number) {
  return Promise.race([
    p,
    new Promise<never>((_, rej) => setTimeout(() => rej(new Error("emit-timeout")), ms)),
  ]);
}
function fireAndForget(p: Promise<any>) {
  p.catch(() => {}); // silence
}

/* ───────────────────────────────────────────────────────────── */

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

      // cart + client context
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

      // resolve base price (+ affiliate flag)
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

      // existing line (branch by affiliate for index usage)
      let existing: any[] = [];
      if (isAffiliate) {
        const { rows } = await client.query(
          `SELECT id, quantity FROM "cartProducts"
            WHERE "cartId"=$1 AND "affiliateProductId"=$2 ${variationId ? `AND "variationId"=$3` : ""}`,
          [cartId, body.productId, ...(variationId ? [variationId] : [])],
        );
        existing = rows;
      } else {
        const { rows } = await client.query(
          `SELECT id, quantity FROM "cartProducts"
            WHERE "cartId"=$1 AND "productId"=$2 ${variationId ? `AND "variationId"=$3` : ""}`,
          [cartId, body.productId, ...(variationId ? [variationId] : [])],
        );
        existing = rows;
      }
      mark("line_lookup");

      // inventory guard (normal only)
      if (!isAffiliate) {
        const inv = await readInventoryFast(client, body.productId);
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

          // Split the SUM so indexes can be used
          const [{ rows: pSum }, { rows: vSum }] = await Promise.all([
            client.query(
              `SELECT COALESCE(SUM(quantity),0)::int AS qty
                 FROM "cartProducts"
                WHERE "cartId"=$1 AND "productId" = ANY($2::text[])`,
              [cartId, tierProdIds],
            ),
            client.query(
              `SELECT COALESCE(SUM(quantity),0)::int AS qty
                 FROM "cartProducts"
                WHERE "cartId"=$1 AND "variationId" = ANY($2::text[])`,
              [cartId, tierVarIds],
            ),
          ]);
          mark("tier_qty_sum");

          const qtyBefore = Number(pSum[0]?.qty ?? 0) + Number(vSum[0]?.qty ?? 0);
          const qtyAfter = qtyBefore - (existing[0]?.quantity ?? 0) + quantity;
          const tierPrice = getPriceForQuantity(tier.steps, qtyAfter);
          if (tierPrice != null && tierPrice !== basePrice) {
            unitPrice = tierPrice;

            // Split the UPDATE as well (avoid OR)
            await client.query(
              `UPDATE "cartProducts"
                  SET "unitPrice"=$1,"updatedAt"=NOW()
                WHERE "cartId"=$2 AND "productId" = ANY($3::text[])`,
              [unitPrice, cartId, tierProdIds],
            );
            await client.query(
              `UPDATE "cartProducts"
                  SET "unitPrice"=$1,"updatedAt"=NOW()
                WHERE "cartId"=$2 AND "variationId" = ANY($3::text[])`,
              [unitPrice, cartId, tierVarIds],
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

      // stock adjust (effective country used above)
      await adjustStock(client, body.productId, variationId, country, -body.quantity);
      mark("adjust_stock");

      // FAST cart hash (aggregate instead of JSON hashing all lines)
      const { rows: hv } = await client.query(
        `SELECT COUNT(*)::int AS n,
                COALESCE(SUM(quantity),0)::int AS q,
                COALESCE(SUM((quantity * "unitPrice")::numeric),0)::text AS v
           FROM "cartProducts"
          WHERE "cartId"=$1`,
        [cartId]
      );
      const hash = crypto.createHash("sha256")
        .update(`${hv[0].n}|${hv[0].q}|${hv[0].v}`)
        .digest("hex");
      await client.query(
        `UPDATE carts SET "cartUpdatedHash"=$1,"updatedAt"=NOW() WHERE id=$2`,
        [hash, cartId]
      );
      mark("hash_update");

      await client.query("COMMIT");
      mark("tx_commit");

      // Fire-and-forget display emit (quiet + timeout budget)
      try {
        setTimeout(() => {
          fireAndForget(withTimeout(emitCartToDisplay(cartId), 300));
        }, 0);
      } catch {}
      mark("emit_display_sched");

      // Single-roundtrip snapshot with proper variant titles
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
      mark("snapshot_query");

      const lines = snap.map((r: any) => {
        const unitPrice = Number(r.unitPrice);
        const title = r.isAffiliate
          ? r.parent_title
          : formatVariationTitle(r.parent_title, r.var_attributes);
        const image = r.isAffiliate ? r.parent_image : (r.var_image ?? r.parent_image ?? null);
        const sku   = r.isAffiliate ? (r.parent_sku ?? null) : (r.var_sku ?? r.parent_sku ?? null);
        return {
          id: r.pid,
          title,
          image,
          sku,
          quantity: Number(r.quantity),
          unitPrice,
          variationId: r.variationId,
          isAffiliate: r.isAffiliate,
          subtotal: unitPrice * Number(r.quantity),
        };
      });

      const totalMs = Date.now() - T0;
      const serverTiming = marks.map(([l, d], i) => `m${i};desc="${l}";dur=${d}`).join(", ");

      console.log(
        `[POS][add-product] cart=${cartId} product=${body.productId} var=${variationId ?? "base"} qty=${body.quantity} ${totalMs}ms`,
        Object.fromEntries(marks)
      );

      return {
        status: 201,
        body: { lines },
        headers: {
          "Server-Timing": serverTiming,
          "X-Route-Duration": `${totalMs}ms`,
        },
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
