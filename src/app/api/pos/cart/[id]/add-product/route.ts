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
        `INSERT INTO idempotency(key, method, path, "createdAt")
         VALUES ($1,$2,$3,NOW())`,
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

function findTier(
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

// Optional stock reader used only for normal products
async function readInventory(
  client: any,
  productId: string,
  variationId: string | null
): Promise<{ manage: boolean; backorder: boolean; stock: number | null }> {
  let manage = false, backorder = false, stock: number | null = null;
  async function safeQuery(sql: string, params: any[], sp: string) {
    await client.query(`SAVEPOINT ${sp}`);
    try { const r = await client.query(sql, params); await client.query(`RELEASE SAVEPOINT ${sp}`); return r; }
    catch (e: any) { await client.query(`ROLLBACK TO SAVEPOINT ${sp}`); if (e?.code==="42703"||e?.code==="42P01") return { rows: [] }; throw e; }
  }
  { // product
    const { rows } = await safeQuery(
      `SELECT COALESCE("manageStock",false) AS manage,
              COALESCE("allowBackorder",COALESCE("backorderAllowed",false)) AS backorder,
              COALESCE("stockQuantity",COALESCE(stock,NULL)) AS stock
         FROM products WHERE id=$1 LIMIT 1`,
      [productId], "inv_p"
    );
    if (rows[0]) { manage=!!rows[0].manage; backorder=!!rows[0].backorder; if (rows[0].stock!=null) stock=Number(rows[0].stock); }
  }
  if (variationId) { // variation
    const { rows } = await safeQuery(
      `SELECT COALESCE("manageStock",false) AS manage,
              COALESCE("allowBackorder",COALESCE("backorderAllowed",false)) AS backorder,
              COALESCE("stockQuantity",COALESCE(stock,NULL)) AS stock
         FROM "productVariations" WHERE id=$1 LIMIT 1`,
      [variationId], "inv_v"
    );
    if (rows[0]) {
      manage = !!rows[0].manage || manage;
      if (rows[0].backorder!=null) backorder = !!rows[0].backorder;
      if (rows[0].stock!=null) stock = Number(rows[0].stock);
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

    try {
      const { id: cartId } = await params;
      const body = BodySchema.parse(await req.json());
      mark("parsed_body");

      const variationId =
        typeof body.variationId === "string" && body.variationId.trim().length > 0
          ? body.variationId
          : null;

      // use CART.country (never null) and channel (to derive store)
      const { rows: cRows } = await pool.query(
        `SELECT ca.country, ca.channel, cl."levelId", cl.id AS "clientId"
           FROM carts ca
           JOIN clients cl ON cl.id = ca."clientId"
          WHERE ca.id = $1`,
        [cartId]
      );
      mark("cart_lookup");
      if (!cRows.length) return { status: 404, body: { error: "Cart or client not found" } };

      let country: string = cRows[0].country;
      const channel: string | null = cRows[0].channel ?? null;
      const levelId: string | null = cRows[0].levelId ?? null;
      const clientId: string = cRows[0].clientId;

      // derive store country from channel (pos-<storeId>-<registerId>)
      let storeCountry: string | null = null;
      const storeId = parseStoreIdFromChannel(channel);
      if (storeId) {
        const { rows: sRows } = await pool.query(
          `SELECT address FROM stores WHERE id=$1 AND "organizationId"=$2`,
          [storeId, (ctx as any).organizationId]
        );
        mark("store_lookup");
        if (sRows[0]?.address) {
          try {
            const addr = typeof sRows[0].address === "string" ? JSON.parse(sRows[0].address) : sRows[0].address;
            if (addr?.country && typeof addr.country === "string") {
              storeCountry = String(addr.country).toUpperCase();
            }
          } catch {}
        }
      }

      // price resolution (+ affiliate flag) with fallback to storeCountry
      let basePrice: number, isAffiliate: boolean;
      try {
        const r = await resolveUnitPrice(body.productId, variationId, country, (levelId ?? "default") as string);
        mark("resolve_price");
        basePrice = r.price;
        isAffiliate = r.isAffiliate;
      } catch (e: any) {
        if (storeCountry && storeCountry !== country) {
          const r2 = await resolveUnitPrice(body.productId, variationId, storeCountry, (levelId ?? "default") as string);
          mark("resolve_price_store_country");
          basePrice = r2.price;
          isAffiliate = r2.isAffiliate;
          country = storeCountry; // adopt store country
          await pool.query(`UPDATE carts SET country=$1 WHERE id=$2`, [country, cartId]);
          mark("cart_country_update");
        } else {
          throw e;
        }
      }

      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        mark("tx_begin");

        // Select existing line by productId or affiliateProductId
        let sql = `SELECT id, quantity
                     FROM "cartProducts"
                    WHERE "cartId"=$1
                      AND ${isAffiliate ? `"affiliateProductId"` : `"productId"`}=$2`;
        const vals: any[] = [cartId, body.productId];
        if (variationId) { sql += ` AND "variationId"=$3`; vals.push(variationId); }
        const { rows: existing } = await client.query(sql, vals);
        mark("line_lookup");

        // inventory enforcement BEFORE change → only for normal products
        if (!isAffiliate) {
          const inv = await readInventory(client, body.productId, variationId);
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

        // affiliate points flow (mirror normal cart)
        if (isAffiliate) {
          const pointsNeeded = basePrice * body.quantity;
          const { rows: bal } = await client.query(
            `SELECT "pointsCurrent" FROM "affiliatePointBalances"
              WHERE "organizationId"=$1
                AND "clientId"=(SELECT "clientId" FROM carts WHERE id=$2)`,
            [(ctx as any).organizationId, cartId],
          );
          mark("affiliate_balance_lookup");
          const current = bal[0]?.pointsCurrent ?? 0;
          if (pointsNeeded > current) {
            await client.query("ROLLBACK");
            return { status: 400, body: { error: "Insufficient affiliate points", required: pointsNeeded, available: current } };
          }
          await client.query(
            `UPDATE "affiliatePointBalances"
                SET "pointsCurrent"="pointsCurrent"-$1,
                    "pointsSpent"  ="pointsSpent"  +$1,
                    "updatedAt"=NOW()
              WHERE "organizationId"=$2
                AND "clientId"=(SELECT "clientId" FROM carts WHERE id=$3)`,
            [pointsNeeded, (ctx as any).organizationId, cartId],
          );
          await client.query(
            `INSERT INTO "affiliatePointLogs"
               (id,"organizationId","clientId",points,action,description,"createdAt","updatedAt")
             VALUES (gen_random_uuid(),$1,
                     (SELECT "clientId" FROM carts WHERE id=$2),
                     $3,'redeem','add to cart',NOW(),NOW())`,
            [(ctx as any).organizationId, cartId, -pointsNeeded],
          );
          mark("affiliate_debit");
        }

        // upsert + tier pricing for normal products
        let quantity = body.quantity + (existing[0]?.quantity ?? 0);
        let unitPrice = basePrice;

        if (!isAffiliate) {
          const tiers = (await tierPricing((ctx as any).organizationId)) as Tier[];
          mark("tier_load");
          const tier = findTier(tiers, country, body.productId, variationId, clientId);
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
            unitPrice = getPriceForQuantity(tier.steps, qtyAfter) ?? basePrice;

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

        // reserve stock (effective country)
        await adjustStock(client, body.productId, variationId, country, -body.quantity);
        mark("adjust_stock");

        // update cart hash
        const { rows: hRows } = await client.query(
          `SELECT COALESCE("productId","affiliateProductId") AS pid, "variationId", quantity,"unitPrice"
             FROM "cartProducts" WHERE "cartId"=$1 ORDER BY "createdAt"`,
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

        // slim product payload (post-commit)
        const prodQuery = isAffiliate
          ? `SELECT id,title,description,image,sku FROM "affiliateProducts" WHERE id=$1`
          : `SELECT id,title,description,image,sku,"regularPrice" FROM products WHERE id=$1`;
        const { rows: prod } = await pool.query(prodQuery, [body.productId]);
        mark("product_lookup");

        // build snapshot (so client doesn't need a second round-trip)
        const [pRows, aRows] = await Promise.all([
          pool.query(
            `SELECT p.id,p.title,p.description,p.image,p.sku,
                    cp.quantity,cp."unitPrice",cp."variationId", false AS "isAffiliate"
               FROM products p
               JOIN "cartProducts" cp ON cp."productId"=p.id
              WHERE cp."cartId"=$1
              ORDER BY cp."createdAt"`,
            [cartId]
          ),
          pool.query(
            `SELECT ap.id,ap.title,ap.description,ap.image,ap.sku,
                    cp.quantity,cp."unitPrice",cp."variationId", true AS "isAffiliate"
               FROM "affiliateProducts" ap
               JOIN "cartProducts"     cp ON cp."affiliateProductId"=ap.id
              WHERE cp."cartId"=$1
              ORDER BY cp."createdAt"`,
            [cartId]
          ),
        ]);
        mark("snapshot_query");

        const lines = [...pRows.rows, ...aRows.rows].map((l: any) => ({
          ...l,
          unitPrice: Number(l.unitPrice),
          subtotal: Number(l.unitPrice) * l.quantity,
        }));

        // broadcast latest cart to the paired customer display
        try { await emitCartToDisplay(cartId); } catch (e) { console.warn("[cd][add] emit failed", e); }
        mark("emit_display");

        const totalMs = Date.now() - T0;
        console.log("[pos:add-product]", { cartId, productId: body.productId, totalMs, marks });
        const serverTiming = marks.map(([l, d], i) => `m${i};desc="${l}";dur=${d}`).join(", ");

        return {
          status: 201,
          body: {
            product: {
              id: prod[0].id,
              variationId,
              title: prod[0].title,
              sku: prod[0].sku,
              description: prod[0].description,
              image: prod[0].image,
              regularPrice: isAffiliate ? {} : prod[0].regularPrice ?? {},
              price: unitPrice,
              stockData: {},
              subtotal: Number(unitPrice) * quantity,
            },
            quantity,
            lines, // full snapshot
          },
          headers: {
            "Server-Timing": serverTiming,
            "X-Route-Duration": `${totalMs}ms`,
          },
        };
      } catch (e) {
        try { await (await pool.connect()).query("ROLLBACK"); } catch {}
        throw e;
      } finally {
        // release inside its own try/catch to be safe
        try { /* client released in its own scope */ } catch {}
      }
    } catch (err: any) {
      if (err instanceof z.ZodError) return { status: 400, body: { error: err.errors } };
      if (typeof err?.message === "string" && err.message.startsWith("No money price for")) {
        return { status: 400, body: { error: err.message } };
      }
      console.error("[POS POST /pos/cart/:id/add-product]", err);
      return { status: 500, body: { error: err.message ?? "Internal server error" } };
    }
  });
}
