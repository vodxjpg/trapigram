import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import crypto from "crypto";
import { pgPool as pool } from "@/lib/db";
import { getContext } from "@/lib/context";
import { adjustStock } from "@/lib/stock";
import { emitCartToDisplay } from "@/lib/customer-display-emit";

/* ───────────────────────────────────────────────────────────── */
/** Idempotency helper aligned with update-product */
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
        await c.query("ROLLBACK");
        const r = await exec();
        return r instanceof NextResponse ? r : NextResponse.json(r.body, { status: r.status });
      }
      throw e;
    }
    const r = await exec();
    await c.query(
      `UPDATE idempotency SET status=$2, response=$3, "updatedAt"=NOW() WHERE key=$1`,
      [key, r instanceof NextResponse ? r.status : r.status, r instanceof NextResponse ? await r.json().catch(() => ({})) : r.body]
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
  productId: z.string(),
  variationId: z.string().nullable().optional(),
});

function parseStoreIdFromChannel(channel: string | null): string | null {
  if (!channel) return null;
  const m = /^pos-([^-\s]+)-/i.exec(channel);
  return m ? m[1] : null;
}

/* Variant title helpers to match update-product snapshot */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function readLabelish(x: any): string | null {
  if (x == null) return null;
  if (typeof x === "string") return UUID_RE.test(x) ? null : (x.trim() || null);
  if (typeof x === "number" || typeof x === "boolean") return String(x);
  if (typeof x === "object") {
    const keys = ["optionName", "valueName", "label", "name", "title", "value", "text"];
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
  } catch { return []; }
}
function formatVariationTitle(parentTitle: string, attributes: any): string {
  const labels = labelsFromAttributes(attributes);
  return labels.length ? `${parentTitle} - ${labels.join(" / ")}` : parentTitle;
}

/* ───────────────────────────────────────────────────────────── */

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;

  const T0 = Date.now();
  const marks: Array<[string, number]> = [];
  const mark = (label: string) => marks.push([label, Date.now() - T0]);

  return withIdempotency(req, async () => {
    try {
      const { id: cartId } = await params;

      // Body or query
      let parsed: z.infer<typeof BodySchema>;
      try {
        const body = await req.json().catch(() => ({} as any));
        parsed = BodySchema.parse(body);
      } catch {
        const url = new URL(req.url);
        parsed = BodySchema.parse({
          productId: url.searchParams.get("productId"),
          variationId: url.searchParams.get("variationId"),
        } as any);
      }
      mark("parsed_body");

      const variationId =
        typeof parsed.variationId === "string" && parsed.variationId.trim().length > 0
          ? parsed.variationId
          : null;
      const withVariation = variationId !== null;

      const dbc = await pool.connect();
      try {
        await dbc.query("BEGIN");
        mark("tx_begin");

        // Two-step delete to avoid OR
        const baseArgs = [cartId, parsed.productId, ...(withVariation ? [variationId] as any[] : [])];
        const whereVar = withVariation ? ` AND "variationId"=$3` : "";

        let deleted: any | null = null;
        {
          const r = await dbc.query(
            `DELETE FROM "cartProducts"
              WHERE "cartId"=$1 AND "productId"=$2${whereVar}
              RETURNING *`,
            baseArgs
          );
          deleted = r.rows[0] ?? null;
        }
        if (!deleted) {
          const r2 = await dbc.query(
            `DELETE FROM "cartProducts"
              WHERE "cartId"=$1 AND "affiliateProductId"=$2${whereVar}
              RETURNING *`,
            baseArgs
          );
          deleted = r2.rows[0] ?? null;
        }
        if (!deleted) {
          await dbc.query("ROLLBACK");
          return NextResponse.json({ error: "Cart line not found" }, { status: 404 });
        }
        mark("delete_line");

        // Context for stock + affiliate refund
        const { rows: cRows } = await dbc.query(
          `SELECT ca.country, ca.channel, ca."clientId", cl."levelId"
             FROM carts ca
             JOIN clients cl ON cl.id = ca."clientId"
            WHERE ca.id = $1`,
          [cartId]
        );
        let country = (cRows[0]?.country || "").toUpperCase();
        const clientId = cRows[0]?.clientId as string | undefined;
        const channel = cRows[0]?.channel as string | undefined;
        mark("cart_lookup");

        // Refund affiliate points if removed an affiliate product
        if (deleted.affiliateProductId && clientId) {
          const qty = Number(deleted.quantity ?? 0);
          const unitPts = Number(deleted.unitPrice ?? 0); // points/unit stored in unitPrice for affiliate
          const pointsRefund = qty > 0 && unitPts > 0 ? qty * unitPts : 0;
          if (pointsRefund > 0) {
            await dbc.query(
              `UPDATE "affiliatePointBalances"
                  SET "pointsCurrent" = "pointsCurrent" + $1,
                      "pointsSpent"   = GREATEST("pointsSpent" - $1, 0),
                      "updatedAt"     = NOW()
                WHERE "organizationId" = $2
                  AND "clientId"       = $3`,
              [pointsRefund, ctx.organizationId, clientId],
            );
            await dbc.query(
              `INSERT INTO "affiliatePointLogs"
                 (id,"organizationId","clientId",points,action,description,"createdAt","updatedAt")
               VALUES (gen_random_uuid(),$1,$2,$3,'refund','remove from pos cart',NOW(),NOW())`,
              [ctx.organizationId, clientId, pointsRefund],
            );
          }
        }
        mark("affiliate_refund");

        // Release stock (+deleted.quantity) — use store-country fallback if present
        const releasedQty = Number(deleted.quantity ?? 0);
        if (releasedQty) {
          let effCountry = country as string;
          const storeId = parseStoreIdFromChannel(channel ?? null);
          if (storeId) {
            const { rows: sRows } = await dbc.query(
              `SELECT address FROM stores WHERE id=$1 AND "organizationId"=$2`,
              [storeId, ctx.organizationId]
            );
            if (sRows[0]?.address) {
              try {
                const addr = typeof sRows[0].address === "string" ? JSON.parse(sRows[0].address) : sRows[0].address;
                if (addr?.country) effCountry = String(addr.country).toUpperCase();
              } catch {}
            }
          }
          await adjustStock(dbc, parsed.productId, variationId, effCountry, +releasedQty);
          country = effCountry;
        }
        mark("adjust_stock");

        // Recompute FAST hash
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

        // Broadcast to customer display (non-blocking)
        try { setTimeout(() => { (async () => { try { await emitCartToDisplay(cartId); } catch {} })(); }, 0); } catch {}
        mark("emit_display_sched");

        // Snapshot (same shape as update-product)
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
      console.error("[POS POST /pos/cart/:id/remove-product]", err);
      if (err instanceof z.ZodError) return NextResponse.json({ error: err.errors }, { status: 400 });
      return NextResponse.json({ error: err.message ?? "Internal server error" }, { status: 500 });
    }
  });
}
  