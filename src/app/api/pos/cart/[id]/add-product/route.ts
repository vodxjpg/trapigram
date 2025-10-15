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

async function withIdempotency(
  req: NextRequest,
  exec: () => Promise<{ status: number; body: any }>
): Promise<NextResponse> {
  const key = req.headers.get("Idempotency-Key");
  if (!key) {
    const r = await exec();
    return NextResponse.json(r.body, { status: r.status });
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
        return NextResponse.json(r.body, { status: r.status });
      }
      throw e;
    }
    const r = await exec();
    await c.query(
      `UPDATE idempotency SET status=$2, response=$3, "updatedAt"=NOW() WHERE key=$1`,
      [key, r.status, r.body]
    );
    await c.query("COMMIT");
    return NextResponse.json(r.body, { status: r.status });
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

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;

  return withIdempotency(req, async () => {
    try {
      const { id: cartId } = await params;
      const body = BodySchema.parse(await req.json());
      const variationId =
        typeof body.variationId === "string" && body.variationId.trim().length > 0
          ? body.variationId
          : null;

      // IMPORTANT: use CART.country (never null), not client.country
      const { rows: cRows } = await pool.query(
        `SELECT ca.country, cl."levelId", cl.id AS "clientId"
           FROM carts ca
           JOIN clients cl ON cl.id = ca."clientId"
          WHERE ca.id = $1`,
        [cartId]
      );
      if (!cRows.length) return { status: 404, body: { error: "Cart or client not found" } };
      const country: string = cRows[0].country;                 // from cart
      const levelId: string | null = cRows[0].levelId ?? null;  // may be null
      const clientId: string = cRows[0].clientId;

      // Base price (own products only). Guard level fallback → 'default'
      const { price: basePrice } = await resolveUnitPrice(
        body.productId,
        variationId,
        country,
        levelId ?? "default",
      );

      const client = await pool.connect();
      try {
        await client.query("BEGIN");

        // Upsert cartProducts row
        let sql = `SELECT id, quantity FROM "cartProducts"
                    WHERE "cartId"=$1 AND "productId"=$2`;
        const vals: any[] = [cartId, body.productId];
        if (variationId) {
          sql += ` AND "variationId"=$3`;
          vals.push(variationId);
        }
        const { rows: existing } = await client.query(sql, vals);

        let quantity = body.quantity;
        if (existing.length) quantity += existing[0].quantity;

        // Tier pricing
        let unitPrice = basePrice;
        const tiers = (await tierPricing(ctx.organizationId)) as Tier[];
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
        }

        // Insert/update line
        if (existing.length) {
          await client.query(
            `UPDATE "cartProducts"
                SET quantity=$1,"unitPrice"=$2,"updatedAt"=NOW()
              WHERE id=$3`,
            [quantity, unitPrice, existing[0].id]
          );
        } else {
          const cols = [`id`,`"cartId"`,`"productId"`,`quantity`,`"unitPrice"`,`"createdAt"`,`"updatedAt"`];
          const vals2: any[] = [uuidv4(), cartId, body.productId, quantity, unitPrice, /* NOW/NOW */];
          let placeholders = "$1,$2,$3,$4,$5,NOW(),NOW()";
          if (variationId) {
            cols.splice(4, 0, `"variationId"`);
            vals2.splice(4, 0, variationId);
            placeholders = "$1,$2,$3,$4,$5,$6,NOW(),NOW()";
          }
          await client.query(
            `INSERT INTO "cartProducts" (${cols.join(",")}) VALUES (${placeholders})`,
            vals2
          );
        }

        // Reserve stock
        await adjustStock(client, body.productId, variationId, country, -body.quantity);

        // Update cart hash
        const { rows: hRows } = await client.query(
          `SELECT "productId","variationId",quantity,"unitPrice"
             FROM "cartProducts" WHERE "cartId"=$1 ORDER BY "createdAt"`,
          [cartId]
        );
        const hash = crypto.createHash("sha256").update(JSON.stringify(hRows)).digest("hex");
        await client.query(
          `UPDATE carts SET "cartUpdatedHash"=$1,"updatedAt"=NOW() WHERE id=$2`,
          [hash, cartId]
        );

        await client.query("COMMIT");

        // Slim product payload (normal products)
        const { rows: prod } = await pool.query(
          `SELECT id,title,description,image,sku,"regularPrice" FROM products WHERE id=$1`,
          [body.productId]
        );
        const product = prod[0] && {
          id: prod[0].id,
          variationId,
          title: prod[0].title,
          sku: prod[0].sku,
          description: prod[0].description,
          image: prod[0].image,
          regularPrice: prod[0].regularPrice ?? {},
          price: unitPrice,
          stockData: {},
          subtotal: Number(unitPrice) * quantity,
        };

        return { status: 201, body: { product, quantity } };
      } catch (e) {
        await client.query("ROLLBACK");
        throw e;
      } finally {
        client.release();
      }
    } catch (err: any) {
      if (err instanceof z.ZodError) return { status: 400, body: { error: err.errors } };
      // Convert the specific pricing throw into a user error
      if (typeof err?.message === "string" && err.message.startsWith("No money price for")) {
        return { status: 400, body: { error: err.message } };
      }
      console.error("[POS POST /pos/cart/:id/add-product]", err);
      return { status: 500, body: { error: err.message ?? "Internal server error" } };
    }
  });
}
