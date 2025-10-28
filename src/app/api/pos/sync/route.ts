import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import crypto from "crypto";
import { pgPool as pool } from "@/lib/db";
import { getContext } from "@/lib/context";
import { resolveUnitPrice } from "@/lib/pricing";
import { withIdempotency } from "@/lib/idempotency";

const Payload = z.object({
  cartId: z.string().min(1),
  ops: z.array(
    z.object({
      op: z.enum(["add", "remove", "set"]),
      productId: z.string().min(1),
      variationId: z.string().nullable().optional(),
      quantity: z.number().int().min(0).optional(), // required for 'set'
    })
  ).min(1),
});

function parseStoreIdFromChannel(channel: string | null): string | null {
  if (!channel) return null;
  const m = /^pos-([^-\s]+)-/i.exec(channel);
  return m ? m[1] : null;
}

export async function POST(req: NextRequest) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;

  return withIdempotency(req, async () => {
    const body = Payload.parse(await req.json());
    const { cartId, ops } = body;

    const dbc = await pool.connect();
    try {
      await dbc.query("BEGIN");

      // Pull cart context once
      const { rows: cartRows } = await dbc.query(
        `SELECT ca.country, ca.channel, cl."levelId"
           FROM carts ca
           JOIN clients cl ON cl.id = ca."clientId"
          WHERE ca.id = $1 LIMIT 1`,
        [cartId]
      );
      if (!cartRows[0]) {
        await dbc.query("ROLLBACK");
        return { status: 404, body: { error: "Cart not found" } };
      }
      let country = String(cartRows[0].country || "").toUpperCase();
      const levelId = cartRows[0].levelId ?? "default";
      const channel = cartRows[0].channel as string | null;

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

      for (const op of ops) {
        const variationId =
          typeof op.variationId === "string" && op.variationId.trim().length > 0 ? op.variationId : null;
        const withVariation = variationId !== null;

        // detect affiliate vs normal
        const [p, ap] = await Promise.all([
          dbc.query(`SELECT id FROM products WHERE id=$1 LIMIT 1`, [op.productId]),
          dbc.query(`SELECT id FROM "affiliateProducts" WHERE id=$1 LIMIT 1`, [op.productId]),
        ]);
        const isAffiliate = !!ap.rows[0] && !p.rows[0];
        if (!p.rows[0] && !ap.rows[0]) {
          await dbc.query("ROLLBACK");
          return { status: 404, body: { error: `Product not found: ${op.productId}` } };
        }

        // resolve base price
        let unit: number;
        if (isAffiliate) {
          const { rows: apr } = await dbc.query(
            `SELECT "regularPoints","salePoints" FROM "affiliateProducts" WHERE id=$1`,
            [op.productId],
          );
          unit =
            apr[0]?.salePoints?.[levelId]?.[country] ??
            apr[0]?.salePoints?.default?.[country] ??
            apr[0]?.regularPoints?.[levelId]?.[country] ??
            apr[0]?.regularPoints?.default?.[country] ?? 0;

          if (unit <= 0 && storeCountry && storeCountry !== country) {
            unit =
              apr[0]?.salePoints?.[levelId]?.[storeCountry] ??
              apr[0]?.salePoints?.default?.[storeCountry] ??
              apr[0]?.regularPoints?.[levelId]?.[storeCountry] ??
              apr[0]?.regularPoints?.default?.[storeCountry] ?? 0;
            if (unit > 0) {
              await dbc.query(`UPDATE carts SET country=$1 WHERE id=$2`, [storeCountry, cartId]);
              country = storeCountry;
            } else {
              continue; // cannot price this line; skip
            }
          }
        } else {
          try {
            unit = (await resolveUnitPrice(op.productId, variationId, country, levelId)).price;
          } catch {
            if (storeCountry && storeCountry !== country) {
              unit = (await resolveUnitPrice(op.productId, variationId, storeCountry, levelId)).price;
              await dbc.query(`UPDATE carts SET country=$1 WHERE id=$2`, [storeCountry, cartId]);
              country = storeCountry;
            } else {
              continue;
            }
          }
        }

        const whereVar = withVariation ? ` AND "variationId"=$3` : "";
        const baseArgs = [cartId, op.productId, ...(withVariation ? [variationId] as any[] : [])];

        if (op.op === "remove") {
          // delete whole line
          const sql = isAffiliate
            ? `DELETE FROM "cartProducts" WHERE "cartId"=$1 AND "affiliateProductId"=$2${whereVar}`
            : `DELETE FROM "cartProducts" WHERE "cartId"=$1 AND "productId"=$2${whereVar}`;
          await dbc.query(sql, baseArgs);
          continue;
        }

        if (op.op === "set") {
          const qty = Math.max(0, Number(op.quantity ?? 0));
          if (qty === 0) {
            const sql = isAffiliate
              ? `DELETE FROM "cartProducts" WHERE "cartId"=$1 AND "affiliateProductId"=$2${whereVar}`
              : `DELETE FROM "cartProducts" WHERE "cartId"=$1 AND "productId"=$2${whereVar}`;
            await dbc.query(sql, baseArgs);
          } else {
            const upSql = isAffiliate
              ? `UPDATE "cartProducts" SET quantity=$1,"unitPrice"=$2,"updatedAt"=NOW()
                   WHERE "cartId"=$3 AND "affiliateProductId"=$4${withVariation ? ` AND "variationId"=$5` : ""}`
              : `UPDATE "cartProducts" SET quantity=$1,"unitPrice"=$2,"updatedAt"=NOW()
                   WHERE "cartId"=$3 AND "productId"=$4${withVariation ? ` AND "variationId"=$5` : ""}`;
            const rc = await dbc.query(upSql, [qty, unit, cartId, op.productId, ...(withVariation ? [variationId] : [])]);
            if (rc.rowCount === 0) {
              const insSql = isAffiliate
                ? `INSERT INTO "cartProducts"
                     ("cartId","affiliateProductId","variationId","quantity","unitPrice","createdAt","updatedAt")
                   VALUES ($1,$2,$3,$4,$5,NOW(),NOW())`
                : `INSERT INTO "cartProducts"
                     ("cartId","productId","variationId","quantity","unitPrice","createdAt","updatedAt")
                   VALUES ($1,$2,$3,$4,$5,NOW(),NOW())`;
              await dbc.query(insSql, [cartId, op.productId, variationId, qty, unit]);
            }
          }
          continue;
        }

        // add
        if (op.op === "add") {
          const exSql = isAffiliate
            ? `SELECT quantity FROM "cartProducts" WHERE "cartId"=$1 AND "affiliateProductId"=$2${whereVar} LIMIT 1`
            : `SELECT quantity FROM "cartProducts" WHERE "cartId"=$1 AND "productId"=$2${whereVar} LIMIT 1`;
          const { rows: ex } = await dbc.query(exSql, baseArgs);
          if (ex[0]) {
            const sql = isAffiliate
              ? `UPDATE "cartProducts" SET quantity=quantity+1,"unitPrice"=$1,"updatedAt"=NOW()
                   WHERE "cartId"=$2 AND "affiliateProductId"=$3${withVariation ? ` AND "variationId"=$4` : ""}`
              : `UPDATE "cartProducts" SET quantity=quantity+1,"unitPrice"=$1,"updatedAt"=NOW()
                   WHERE "cartId"=$2 AND "productId"=$3${withVariation ? ` AND "variationId"=$4` : ""}`;
            await dbc.query(sql, [unit, cartId, op.productId, ...(withVariation ? [variationId] : [])]);
          } else {
            const insSql = isAffiliate
              ? `INSERT INTO "cartProducts"
                   ("cartId","affiliateProductId","variationId","quantity","unitPrice","createdAt","updatedAt")
                 VALUES ($1,$2,$3,1,$4,NOW(),NOW())`
              : `INSERT INTO "cartProducts"
                   ("cartId","productId","variationId","quantity","unitPrice","createdAt","updatedAt")
                 VALUES ($1,$2,$3,1,$4,NOW(),NOW())`;
            await dbc.query(insSql, [cartId, op.productId, variationId, unit]);
          }
        }
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

      // Return minimal snapshot (count, quantity, value) plus lines for UI if desired
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

      return { status: 200, body: { lines: snap, hash: newHash } };
    } catch (e) {
      try { await (pool as any).query("ROLLBACK"); } catch {}
      throw e;
    } finally {
      dbc.release();
    }
  });
}
