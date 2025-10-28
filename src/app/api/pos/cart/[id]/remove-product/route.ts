import { NextRequest } from "next/server";
import { z } from "zod";
import crypto from "crypto";
import { pgPool as pool } from "@/lib/db";
import { getContext } from "@/lib/context";
import { withIdempotency } from "@/lib/idempotency";
import { emitCartToDisplay } from "@/lib/customer-display-emit";

const BodySchema = z.object({
  productId: z.string(),               // normal product OR affiliateProduct id
  variationId: z.string().nullable().optional(),
});

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

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getContext(req);
  if (ctx instanceof Response) return ctx as any;

  return withIdempotency(req, async () => {
    const { id: cartId } = await params;

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

    const variationId =
      typeof parsed.variationId === "string" && parsed.variationId.trim().length > 0
        ? parsed.variationId
        : null;
    const withVariation = variationId !== null;

    const dbc = await pool.connect();
    try {
      await dbc.query("BEGIN");

      // Try normal, then affiliate
      const baseArgs = [cartId, parsed.productId, ...(withVariation ? [variationId] as any[] : [])];

      let deleted: any | null = null;
      {
        const r = await dbc.query(
          `DELETE FROM "cartProducts"
            WHERE "cartId"=$1 AND "productId"=$2${withVariation ? ` AND "variationId"=$3` : ""}
            RETURNING *`,
          baseArgs
        );
        deleted = r.rows[0] ?? null;
      }
      if (!deleted) {
        const r2 = await dbc.query(
          `DELETE FROM "cartProducts"
            WHERE "cartId"=$1 AND "affiliateProductId"=$2${withVariation ? ` AND "variationId"=$3` : ""}
            RETURNING *`,
          baseArgs
        );
        deleted = r2.rows[0] ?? null;
      }
      if (!deleted) {
        await dbc.query("ROLLBACK");
        return { status: 404, body: { error: "Cart line not found" } };
      }

      // Hash
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

      await dbc.query("COMMIT");

      setTimeout(() => { emitCartToDisplay(cartId).catch(() => {}); }, 0);

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

      return { status: 200, body: { lines } };
    } catch (e) {
      try { await (pool as any).query("ROLLBACK"); } catch {}
      throw e;
    } finally {
      dbc.release();
    }
  });
}
