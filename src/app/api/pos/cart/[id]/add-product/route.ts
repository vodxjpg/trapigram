import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import crypto from "crypto";
import { pgPool as pool } from "@/lib/db";
import { getContext } from "@/lib/context";
import { adjustStock } from "@/lib/stock";
import { resolveUnitPrice } from "@/lib/pricing";
import { emitCartToDisplay } from "@/lib/customer-display-emit";

/* ───────────────────────────────────────────────────────────── */
/** Idempotency helper (safe: does not consume original response body) */
async function withIdempotency(
  req: NextRequest,
  exec: () => Promise<{ status: number; body: any } | NextResponse>
): Promise<NextResponse> {
  const key = req.headers.get("Idempotency-Key");
  if (!key) {
    const r = await exec();
    return r instanceof NextResponse ? r : NextResponse.json(r.body, { status: r.status });
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
        // table missing; just run without idempotency persistence
        await c.query("ROLLBACK");
        const r = await exec();
        return r instanceof NextResponse ? r : NextResponse.json(r.body, { status: r.status });
      }
      throw e;
    }

    const r = await exec();

    // Safely capture a JSON body for replay WITHOUT locking the original response
    const status = r instanceof NextResponse ? r.status : r.status;
    const body =
      r instanceof NextResponse
        ? await r.clone().json().catch(() => ({}))
        : r.body;

    await c.query(
      `UPDATE idempotency SET status=$2, response=$3, "updatedAt"=NOW() WHERE key=$1`,
      [key, status, body]
    );
    await c.query("COMMIT");

    return r instanceof NextResponse ? r : NextResponse.json(r.body, { status: r.status });
  } catch (err) {
    await c.query("ROLLBACK");
    throw err;
  } finally {
    c.release();
  }
}
/* ───────────────────────────────────────────────────────────── */

const BodySchema = z.object({
  productId: z.string(),               // normal product id or affiliateProduct id
  variationId: z.string().nullable().optional(),
});

function parseStoreIdFromChannel(channel: string | null): string | null {
  if (!channel) return null;
  const m = /^pos-([^-\s]+)-/i.exec(channel);
  return m ? m[1] : null;
}

/** Inventory reader aligned with update-product (placeholder stock column for now) */
async function readInventoryFast(
  client: any,
  productId: string,
  variationId: string | null
): Promise<{ manage: boolean; backorder: boolean; stock: number | null }> {
  const safeQuery = async (sql: string, params: any[], sp: string) => {
    await client.query(`SAVEPOINT ${sp}`);
    try { const r = await client.query(sql, params); await client.query(`RELEASE SAVEPOINT ${sp}`); return r; }
    catch (e: any) { await client.query(`ROLLBACK TO SAVEPOINT ${sp}`); if (e?.code === "42703" || e?.code === "42P01") return { rows: [] }; throw e; }
  };

  const p = await safeQuery(
    `SELECT COALESCE("manageStock",false) AS manage,
            COALESCE("allowBackorders",false) AS backorder
       FROM products WHERE id=$1 LIMIT 1`,
    [productId],
    "inv_p",
  );

  let manage = !!p.rows?.[0]?.manage;
  let backorder = !!p.rows?.[0]?.backorder;
  let stock: number | null = null;

  if (variationId) {
    const v = await safeQuery(
      `SELECT COALESCE("manageStock",false) AS manage,
              COALESCE("allowBackorders",false) AS backorder,
              NULL::int AS stock
         FROM "productVariations" WHERE id=$1 LIMIT 1`,
      [variationId],
      "inv_v",
    );
    if (v.rows?.[0]) {
      manage = !!v.rows[0].manage || manage;
      if (v.rows[0].backorder != null) backorder = !!v.rows[0].backorder;
    }
  }
  return { manage, backorder, stock };
}

/* Variant title helpers (same as update-product) */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function readLabelish(x: any): string | null {
  if (x == null) return null;
  if (typeof x === "string") return UUID_RE.test(x) ? null : (x.trim() || null);
  if (typeof x === "number" || typeof x === "boolean") return String(x);
  if (typeof x === "object") {
    const keys = ["optionName", "valueName", "label", "name", "title", "value", "text"];
    for (const k of keys) {
      if ((x as any)[k] != null) {
        const v = readLabelish((x as any)[k]);
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
        const v = readLabelish((it as any)?.value) ?? readLabelish((it as any)?.optionName) ?? readLabelish(it);
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
  } catch { return []; }
}
function formatVariationTitle(parentTitle: string, attributes: any): string {
  const labels = labelsFromAttributes(attributes);
  return labels.length ? `${parentTitle} - ${labels.join(" / ")}` : parentTitle;
}

/* ───────────────────────────────────────────────────────────── */

const Body = BodySchema;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;

  const T0 = Date.now();
  const marks: Array<[string, number]> = [];
  const mark = (label: string) => marks.push([label, Date.now() - T0]);

  return withIdempotency(req, async () => {
    try {
      const { id: cartId } = await params;

      // Parse body or query
      let parsed: z.infer<typeof Body>;
      try {
        const body = await req.json().catch(() => ({} as any));
        parsed = Body.parse(body);
      } catch {
        const url = new URL(req.url);
        parsed = Body.parse({
          productId: url.searchParams.get("productId"),
          variationId: url.searchParams.get("variationId"),
        } as any);
      }
      mark("parsed_body");

      const variationId =
        typeof parsed.variationId === "string" && parsed.variationId.trim().length > 0
          ? parsed.variationId
          : null;

      const dbc = await pool.connect();
      try {
        await dbc.query("BEGIN");
        mark("tx_begin");

        // Get cart context
        const { rows: cartRows } = await dbc.query(
          `SELECT ca.country, ca.channel, ca."clientId", cl."levelId"
             FROM carts ca
             JOIN clients cl ON cl.id = ca."clientId"
            WHERE ca.id = $1
            LIMIT 1`,
          [cartId],
        );
        if (!cartRows[0]) {
          await dbc.query("ROLLBACK");
          return NextResponse.json({ error: "Cart not found" }, { status: 404 });
        }
        let country = String(cartRows[0].country || "").toUpperCase();
        const channel: string | null = cartRows[0].channel ?? null;
        const clientId: string = cartRows[0].clientId;
        const levelId: string = cartRows[0].levelId ?? "default";
        mark("cart_lookup");

        // Determine if incoming id is normal product or affiliate
        let isAffiliate = false;
        {
          const [p, ap] = await Promise.all([
            dbc.query(`SELECT id FROM products WHERE id=$1 LIMIT 1`, [parsed.productId]),
            dbc.query(`SELECT id FROM "affiliateProducts" WHERE id=$1 LIMIT 1`, [parsed.productId]),
          ]);
          if (!p.rows[0] && !ap.rows[0]) {
            await dbc.query("ROLLBACK");
            return NextResponse.json({ error: "Product not found" }, { status: 404 });
          }
          isAffiliate = !!ap.rows[0] && !p.rows[0];
        }
        mark("kind_detect");

        // Derive store country from channel for fallback pricing
        let storeCountry: string | null = null;
        const storeId = parseStoreIdFromChannel(channel);
        if (storeId) {
          const { rows: sRows } = await dbc.query(
            `SELECT address FROM stores WHERE id=$1 AND "organizationId"=$2`,
            [storeId, ctx.organizationId]
          );
          if (sRows[0]?.address) {
            try {
              const addr = typeof sRows[0].address === "string" ? JSON.parse(sRows[0].address) : sRows[0].address;
              if (addr?.country && typeof addr.country === "string") {
                storeCountry = String(addr.country).toUpperCase();
              }
            } catch {}
          }
        }
        mark("store_lookup");

        // Resolve unit price
        let unit: number;
        if (isAffiliate) {
          const { rows: ap } = await dbc.query(
            `SELECT "regularPoints","salePoints" FROM "affiliateProducts" WHERE id=$1`,
            [parsed.productId],
          );
          const pts =
            ap[0]?.salePoints?.[levelId]?.[country] ??
            ap[0]?.salePoints?.default?.[country] ??
            ap[0]?.regularPoints?.[levelId]?.[country] ??
            ap[0]?.regularPoints?.default?.[country] ?? 0;

          if (pts > 0) {
            unit = pts;
          } else if (storeCountry && storeCountry !== country) {
            const pts2 =
              ap[0]?.salePoints?.[levelId]?.[storeCountry] ??
              ap[0]?.salePoints?.default?.[storeCountry] ??
              ap[0]?.regularPoints?.[levelId]?.[storeCountry] ??
              ap[0]?.regularPoints?.default?.[storeCountry] ?? 0;
            if (pts2 > 0) {
              unit = pts2;
              await dbc.query(`UPDATE carts SET country=$1 WHERE id=$2`, [storeCountry, cartId]);
              country = storeCountry;
            } else {
              await dbc.query("ROLLBACK");
              return NextResponse.json({ error: "No points price configured for this product" }, { status: 400 });
            }
          } else {
            await dbc.query("ROLLBACK");
            return NextResponse.json({ error: "No points price configured for this product" }, { status: 400 });
          }

          // Affiliate balance check (adding 1)
          const { rows: balRows } = await dbc.query(
            `SELECT "pointsCurrent" FROM "affiliatePointBalances"
               WHERE "organizationId"=$1 AND "clientId"=$2`,
            [ctx.organizationId, clientId],
          );
          const pointsCurrent = Number(balRows[0]?.pointsCurrent ?? 0);
          if (unit > pointsCurrent) {
            await dbc.query("ROLLBACK");
            return NextResponse.json(
              { error: "Insufficient affiliate points", required: unit, available: pointsCurrent },
              { status: 400 },
            );
          }
        } else {
          try {
            unit = (await resolveUnitPrice(parsed.productId, variationId, country, levelId)).price;
          } catch (e: any) {
            if (storeCountry && storeCountry !== country) {
              unit = (await resolveUnitPrice(parsed.productId, variationId, storeCountry, levelId)).price;
              await dbc.query(`UPDATE carts SET country=$1 WHERE id=$2`, [storeCountry, cartId]);
              country = storeCountry;
            } else {
              throw e;
            }
          }
        }
        mark("resolve_price");

        // Existing line? (NOTE: two whereVar strings to keep indexes correct)
        const withVariation = variationId !== null;
        const whereVarSel = withVariation ? ` AND "variationId"=$3` : "";
        const baseArgsSel = [cartId, parsed.productId, ...(withVariation ? [variationId] as any[] : [])];

        let existingQty = 0;
        if (isAffiliate) {
          const { rows } = await dbc.query(
            `SELECT quantity FROM "cartProducts"
              WHERE "cartId"=$1 AND "affiliateProductId"=$2${whereVarSel}
              LIMIT 1`,
            baseArgsSel
          );
          existingQty = Number(rows?.[0]?.quantity ?? 0);
        } else {
          const { rows } = await dbc.query(
            `SELECT quantity FROM "cartProducts"
              WHERE "cartId"=$1 AND "productId"=$2${whereVarSel}
              LIMIT 1`,
            baseArgsSel
          );
          existingQty = Number(rows?.[0]?.quantity ?? 0);
        }
        mark("line_lookup");

        // Inventory enforcement (normal products only)
        if (!isAffiliate) {
          const inv = await readInventoryFast(dbc, parsed.productId, variationId);
          if (inv.manage && !inv.backorder && inv.stock !== null) {
            const nextQty = existingQty + 1;
            if (nextQty > inv.stock) {
              await dbc.query("ROLLBACK");
              return NextResponse.json(
                { error: `Only ${inv.stock} unit${inv.stock === 1 ? "" : "s"} available for this item.`, available: inv.stock },
                { status: 400 }
              );
            }
          }
        }
        mark("inventory_check");

        // Persist (⚠️ FIXED PARAM INDEXES BELOW)
        if (isAffiliate) {
          if (existingQty > 0) {
            const whereVarUpd = withVariation ? ` AND "variationId"=$4` : ""; // $4 (NOT $3)
            await dbc.query(
              `UPDATE "cartProducts"
                  SET quantity=quantity+1, "unitPrice"=$1, "updatedAt"=NOW()
                WHERE "cartId"=$2 AND "affiliateProductId"=$3${whereVarUpd}`,
              [unit, cartId, parsed.productId, ...(withVariation ? [variationId] : [])]
            );
          } else {
            await dbc.query(
              `INSERT INTO "cartProducts"
                 ("cartId","affiliateProductId","variationId","quantity","unitPrice","createdAt","updatedAt")
               VALUES ($1,$2,$3,1,$4,NOW(),NOW())`,
              [cartId, parsed.productId, variationId, unit]
            );
          }

          // Deduct affiliate points for +1
          await dbc.query(
            `UPDATE "affiliatePointBalances"
                SET "pointsCurrent"="pointsCurrent"-$1,
                    "pointsSpent"  ="pointsSpent"+$1,
                    "updatedAt"=NOW()
              WHERE "organizationId"=$2 AND "clientId"=$3`,
            [unit, ctx.organizationId, clientId],
          );
          await dbc.query(
            `INSERT INTO "affiliatePointLogs"
               (id,"organizationId","clientId",points,action,description,"createdAt","updatedAt")
             VALUES (gen_random_uuid(),$1,$2,$3,'redeem','add to pos cart',NOW(),NOW())`,
            [ctx.organizationId, clientId, -unit],
          );
        } else {
          if (existingQty > 0) {
            const whereVarUpd = withVariation ? ` AND "variationId"=$4` : ""; // $4 (NOT $3)
            await dbc.query(
              `UPDATE "cartProducts"
                  SET quantity=quantity+1, "unitPrice"=$1, "updatedAt"=NOW()
                WHERE "cartId"=$2 AND "productId"=$3${whereVarUpd}`,
              [unit, cartId, parsed.productId, ...(withVariation ? [variationId] : [])]
            );
          } else {
            await dbc.query(
              `INSERT INTO "cartProducts"
                 ("cartId","productId","variationId","quantity","unitPrice","createdAt","updatedAt")
               VALUES ($1,$2,$3,1,$4,NOW(),NOW())`,
              [cartId, parsed.productId, variationId, unit]
            );
          }
        }
        mark("persist");

        // Adjust stock (-1)
        await adjustStock(dbc, parsed.productId, variationId, country, -1);
        mark("adjust_stock");

        // FAST cart hash
        const { rows: hv } = await dbc.query(
          `SELECT COUNT(*)::int AS n,
                  COALESCE(SUM(quantity),0)::int AS q,
                  COALESCE(SUM((quantity * "unitPrice")::numeric),0)::text AS v
             FROM "cartProducts" WHERE "cartId"=$1`,
          [cartId]
        );
        const newHash = crypto.createHash("sha256")
          .update(`${hv[0].n}|${hv[0].q}|${hv[0].v}`)
          .digest("hex");
        await dbc.query(
          `UPDATE carts SET "cartUpdatedHash"=$1,"updatedAt"=NOW() WHERE id=$2`,
          [newHash, cartId]
        );
        mark("hash_update");

        await dbc.query("COMMIT");
        mark("tx_commit");

        // broadcast to customer display (non-blocking)
        try { setTimeout(() => { (async () => { try { await emitCartToDisplay(cartId); } catch {} })(); }, 0); } catch {}
        mark("emit_display_sched");

        // Snapshot
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
        const lines = snap.map((r: any) => {
          const unitPrice = Number(r.unitPrice);
          const title = r.isAffiliate
            ? r.parent_title
            : formatVariationTitle(r.parent_title, r.var_attributes);
          const image = r.isAffiliate ? r.parent_image : (r.var_image ?? r.parent_image ?? null);
          const sku = r.isAffiliate ? (r.parent_sku ?? null) : (r.var_sku ?? r.parent_sku ?? null);
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
        const res = NextResponse.json({ lines }, { status: 200 });
        res.headers.set("Server-Timing", serverTiming);
        res.headers.set("X-Route-Duration", `${totalMs}ms`);
        return res;
      } catch (e) {
        await dbc.query("ROLLBACK");
        throw e;
      } finally {
        dbc.release();
      }
    } catch (err: any) {
      if (err instanceof z.ZodError) return NextResponse.json({ error: err.errors }, { status: 400 });
      if (typeof err?.message === "string" && err.message.startsWith("No money price for")) {
        return NextResponse.json({ error: err.message }, { status: 400 });
      }
      console.error("[POS POST /pos/cart/:id/add-product]", err);
      return NextResponse.json({ error: err.message ?? "Internal server error" }, { status: 500 });
    }
  });
}
