export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { pgPool as pool } from "@/lib/db";
import { getContext } from "@/lib/context";
import crypto from "crypto";
import { v4 as uuidv4 } from "uuid";
import { resolveUnitPrice } from "@/lib/pricing";
import { adjustStock } from "@/lib/stock";
import { emitCartToDisplay } from "@/lib/customer-display-emit";

/* ── tiny TTL caches ───────────────────────────────────────── */
type PriceKey = `${string}|${string}|${string}|${string}|${string}`; // org|product|variation|null|country|level
const PRICE_TTL_MS = 60_000;
const priceCache = new Map<PriceKey, { at: number; price: number; isAffiliate: boolean }>();
const priceKey = (org: string, p: string, v: string | null, c: string, lvl: string) =>
  `${org}|${p}|${v ?? "-"}|${c}|${lvl}` as PriceKey;

const STORE_TTL_MS = 5 * 60_000;
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

/* ── helpers ───────────────────────────────────────────────── */
const BodySchema = z.object({
  productId: z.string(),
  variationId: z.string().nullable().optional(),
  quantity: z.number().int().positive(),
});

const BASE_HEADERS: Record<string, string> = {
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
  "X-Content-Type-Options": "nosniff",
};

function parseStoreIdFromChannel(channel: string | null): string | null {
  if (!channel) return null;
  const m = /^pos-([^-\s]+)-/i.exec(channel);
  return m ? m[1] : null;
}

async function withIdempotency(
  req: NextRequest,
  exec: () => Promise<{ status: number; body: any; headers?: Record<string, string> }>
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
      await c.query(`INSERT INTO idempotency(key, method, path, "createdAt") VALUES ($1,$2,$3,NOW())`, [key, method, path]);
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
    await c.query(`UPDATE idempotency SET status=$2, response=$3, "updatedAt"=NOW() WHERE key=$1`, [key, r.status, r.body]);
    await c.query("COMMIT");
    return NextResponse.json(r.body, { status: r.status, headers: { ...BASE_HEADERS, ...(r.headers ?? {}) } });
  } catch (err) {
    await c.query("ROLLBACK");
    throw err;
  } finally {
    c.release();
  }
}

/* ── endpoint ───────────────────────────────────────────────── */

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;

  return withIdempotency(req, async () => {
    const T0 = Date.now();
    const marks: Array<[string, number]> = [];
    const mark = (label: string) => marks.push([label, Date.now() - T0]);

    const { organizationId } = ctx as { organizationId: string };
    const { id: cartId } = await params;
    const url = new URL(req.url);
    const wantSnapshot = url.searchParams.get("snapshot") === "1";

    const body = BodySchema.parse(await req.json());
    mark("parse");

    const variationId = body.variationId && body.variationId.trim() ? body.variationId : null;

    const { rows: cRows } = await pool.query(
      `SELECT ca.country, ca.channel, cl."levelId", cl.id AS "clientId"
         FROM carts ca
         JOIN clients cl ON cl.id = ca."clientId"
        WHERE ca.id = $1`,
      [cartId]
    );
    mark("cart_ctx");
    if (!cRows.length) return { status: 404, body: { error: "Cart or client not found" } };

    let country: string = cRows[0].country;
    const channel: string | null = cRows[0].channel ?? null;
    const levelId: string = (cRows[0].levelId ?? "default") as string;
    const clientId: string = cRows[0].clientId;

    const storeId = parseStoreIdFromChannel(channel);
    const storeCountry = storeId ? await getStoreCountryCached(storeId, organizationId) : null;
    mark("store_lookup");

    async function resolveBase(): Promise<{ price: number; isAffiliate: boolean; usedCountry: string }> {
      const k = priceKey(organizationId, body.productId, variationId, country, levelId);
      const now = Date.now();
      const hit = priceCache.get(k);
      if (hit && now - hit.at < PRICE_TTL_MS) return { price: hit.price, isAffiliate: hit.isAffiliate, usedCountry: country };
      try {
        const r = await resolveUnitPrice(body.productId, variationId, country, levelId);
        priceCache.set(k, { at: now, price: r.price, isAffiliate: r.isAffiliate });
        return { price: r.price, isAffiliate: r.isAffiliate, usedCountry: country };
      } catch (e) {
        if (storeCountry && storeCountry !== country) {
          const r2 = await resolveUnitPrice(body.productId, variationId, storeCountry, levelId);
          await pool.query(`UPDATE carts SET country=$1 WHERE id=$2`, [storeCountry, cartId]);
          const k2 = priceKey(organizationId, body.productId, variationId, storeCountry, levelId);
          priceCache.set(k2, { at: now, price: r2.price, isAffiliate: r2.isAffiliate });
          return { price: r2.price, isAffiliate: r2.isAffiliate, usedCountry: storeCountry };
        }
        throw e;
      }
    }
    const { price: basePrice, isAffiliate, usedCountry } = await resolveBase();
    mark("price");

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      mark("tx_begin");

      // Affiliate points (if needed)
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
                 "pointsSpent"  ="pointsSpent"+$1,
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
      mark("affiliate");

      // Single UPSERT (uses partial unique indexes above)
      const newId = uuidv4();
      const isAff = isAffiliate;

      const insertSql = isAff
        ? `
          INSERT INTO "cartProducts"
            (id,"cartId","productId","affiliateProductId","variationId",quantity,"unitPrice","createdAt","updatedAt")
          VALUES ($1,$2,NULL,$3,$4,$5,$6,NOW(),NOW())
          ON CONFLICT ("cartId","affiliateProductId","variationId")
          WHERE "productId" IS NULL
          DO UPDATE SET
            quantity    = "cartProducts".quantity + EXCLUDED.quantity,
            "unitPrice" = EXCLUDED."unitPrice",
            "updatedAt" = NOW()
          RETURNING id, quantity, "unitPrice","variationId"
        `
        : `
          INSERT INTO "cartProducts"
            (id,"cartId","productId","affiliateProductId","variationId",quantity,"unitPrice","createdAt","updatedAt")
          VALUES ($1,$2,$3,NULL,$4,$5,$6,NOW(),NOW())
          ON CONFLICT ("cartId","productId","variationId")
          WHERE "affiliateProductId" IS NULL
          DO UPDATE SET
            quantity    = "cartProducts".quantity + EXCLUDED.quantity,
            "unitPrice" = EXCLUDED."unitPrice",
            "updatedAt" = NOW()
          RETURNING id, quantity, "unitPrice","variationId"
        `;

      const { rows: up } = await client.query(insertSql, [
        newId,
        cartId,
        body.productId,
        variationId,
        body.quantity,
        basePrice,
      ]);
      const line = up[0];
      mark("upsert");

      // adjust stock (atomic)
      await adjustStock(client, body.productId, variationId, usedCountry, -body.quantity);
      mark("stock");

      // fast aggregate + hash
      const { rows: hv } = await client.query(
        `SELECT COUNT(*)::int AS n,
                COALESCE(SUM(quantity),0)::int AS q,
                COALESCE(SUM((quantity * "unitPrice")::numeric),0)::text AS v
           FROM "cartProducts"
          WHERE "cartId"=$1`,
        [cartId]
      );
      const hash = crypto.createHash("sha256").update(`${hv[0].n}|${hv[0].q}|${hv[0].v}`).digest("hex");
      await client.query(`UPDATE carts SET "cartUpdatedHash"=$1,"updatedAt"=NOW() WHERE id=$2`, [hash, cartId]);
      mark("hash");

      await client.query("COMMIT");
      mark("commit");

      // non-blocking display emit
      try { setTimeout(() => { emitCartToDisplay(cartId).catch(() => {}); }, 0); } catch {}

      const totals = {
        lineCount: Number(hv[0].n),
        quantity: Number(hv[0].q),
        value: Number(hv[0].v),
        cartHash: hash,
      };

      const resBody = {
        changedLine: {
          productId: body.productId,
          variationId,
          isAffiliate,
          unitPrice: Number(line.unitPrice),
          deltaQuantity: body.quantity,
          newQuantity: Number(line.quantity),
        },
        totals,
      };

      const serverTiming = marks.map(([l, d], i) => `m${i};desc="${l}";dur=${d}`).join(", ");
      const res = NextResponse.json(resBody, { status: 201, headers: BASE_HEADERS });
      res.headers.set("Server-Timing", serverTiming);
      res.headers.set("X-Route-Duration", `${Date.now() - T0}ms`);
      return res;
    } catch (err: any) {
      try { await (await pool.connect()).query("ROLLBACK"); } catch {}
      if (err instanceof z.ZodError) return { status: 400, body: { error: err.errors }, headers: BASE_HEADERS };
      if (typeof err?.message === "string" && err.message.startsWith("No money price for")) {
        return { status: 400, body: { error: err.message }, headers: BASE_HEADERS };
      }
      console.error("[POS POST /pos/cart/:id/add-product][upsert]", err);
      return { status: 500, body: { error: "Internal server error" }, headers: BASE_HEADERS };
    }
  });
}
