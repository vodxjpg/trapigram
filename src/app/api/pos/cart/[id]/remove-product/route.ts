import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { pgPool as pool } from "@/lib/db";
import crypto from "crypto";
import { getContext } from "@/lib/context";
import { adjustStock } from "@/lib/stock";
import { emitCartToDisplay } from "@/lib/customer-display-emit";

/** Idempotency helper (unchanged) */
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
          `SELECT status, response FROM idempotency WHERE key = $1`,
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
});

function parseStoreIdFromChannel(channel: string | null): string | null {
  if (!channel) return null;
  const m = /^pos-([^-\s]+)-/i.exec(channel);
  return m ? m[1] : null;
}

async function computeCartHash(cartId: string): Promise<string> {
  const { rows } = await pool.query(
    `SELECT COALESCE("productId","affiliateProductId") AS pid,
            "variationId", quantity,"unitPrice"
       FROM "cartProducts"
      WHERE "cartId" = $1
      ORDER BY "createdAt"`,
    [cartId],
  );
  return crypto.createHash("sha256").update(JSON.stringify(rows ?? [])).digest("hex");
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;

  return withIdempotency(req, async () => {
    try {
      const { id: cartId } = await params;
      // Allow body or query params
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

      const normVariationId =
        typeof parsed.variationId === "string" && parsed.variationId.trim().length > 0
          ? parsed.variationId
          : null;
      const withVariation = normVariationId !== null;

      // Two-step delete to use indexes and avoid OR
      const baseArgs = [cartId, parsed.productId, ...(withVariation ? [normVariationId] as any[] : [])];
      const whereVar = withVariation ? ` AND "variationId"=$3` : "";
      let deleted: any | null = null;

      {
        const r = await pool.query(
          `DELETE FROM "cartProducts"
            WHERE "cartId"=$1 AND "productId"=$2${whereVar}
            RETURNING *`,
          baseArgs
        );
        deleted = r.rows[0] ?? null;
      }
      if (!deleted) {
        const r2 = await pool.query(
          `DELETE FROM "cartProducts"
            WHERE "cartId"=$1 AND "affiliateProductId"=$2${whereVar}
            RETURNING *`,
          baseArgs
        );
        deleted = r2.rows[0] ?? null;
      }
      if (!deleted) return { status: 404, body: { error: "Cart line not found" } };

      // Context for stock + affiliate refund
      const { rows: cRows } = await pool.query(
        `SELECT ca.country, ca.channel, cl."levelId", ca."clientId"
           FROM carts ca
           JOIN clients cl ON cl.id = ca."clientId"
          WHERE ca.id = $1`,
        [cartId]
      );
      let country = cRows[0]?.country as string | undefined;
      const clientId = cRows[0]?.clientId as string | undefined;
      const channel = cRows[0]?.channel as string | undefined;

      // Refund affiliate points if removed an affiliate product
      if (deleted.affiliateProductId && clientId) {
        const qty = Number(deleted.quantity ?? 0);
        const unitPts = Number(deleted.unitPrice ?? 0); // points/unit in unitPrice for affiliate
        const pointsRefund = qty > 0 && unitPts > 0 ? qty * unitPts : 0;
        if (pointsRefund > 0) {
          await pool.query(
            `UPDATE "affiliatePointBalances"
                SET "pointsCurrent" = "pointsCurrent" + $1,
                    "pointsSpent"   = GREATEST("pointsSpent" - $1, 0),
                    "updatedAt"     = NOW()
              WHERE "organizationId" = $2
                AND "clientId"      = $3`,
            [pointsRefund, (ctx as any).organizationId, clientId],
          );
          await pool.query(
            `INSERT INTO "affiliatePointLogs"
               (id,"organizationId","clientId",points,action,description,"createdAt","updatedAt")
             VALUES (gen_random_uuid(),$1,$2,$3,'refund','remove from pos cart',NOW(),NOW())`,
            [(ctx as any).organizationId, clientId, pointsRefund],
          );
        }
      }

      // Release stock (effective country)
      const releasedQty = Number(deleted.quantity ?? 0);
      if (releasedQty) {
        let effCountry = country as string;
        const storeId = parseStoreIdFromChannel(channel ?? null);
        if (storeId) {
          const { rows: sRows } = await pool.query(
            `SELECT address FROM stores WHERE id=$1 AND "organizationId"=$2`,
            [storeId, (ctx as any).organizationId]
          );
          if (sRows[0]?.address) {
            try {
              const addr = typeof sRows[0].address === "string" ? JSON.parse(sRows[0].address) : sRows[0].address;
              if (addr?.country) effCountry = String(addr.country).toUpperCase();
            } catch {}
          }
        }
        await adjustStock(pool as any, parsed.productId, normVariationId, effCountry, +releasedQty);
        country = effCountry;
      }

      // Recompute hash
      const newHash = await computeCartHash(cartId);
      await pool.query(
        `UPDATE carts
            SET "cartUpdatedHash"=$1,"updatedAt"=NOW()
          WHERE id=$2`,
        [newHash, cartId],
      );

      // broadcast latest cart to the paired customer display
      try { await emitCartToDisplay(cartId); } catch (e) { console.warn("[cd][remove] emit failed", e); }

      // Return a snapshot (like update-product)
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

      const lines = [...pRows.rows, ...aRows.rows].map((l: any) => ({
        ...l,
        unitPrice: Number(l.unitPrice),
        subtotal: Number(l.unitPrice) * l.quantity,
      }));

      return { status: 200, body: { lines } };
    } catch (err: any) {
      console.error("[POS POST /pos/cart/:id/remove-product]", err);
      if (err instanceof z.ZodError) return { status: 400, body: { error: err.errors } };
      return { status: 500, body: { error: err.message ?? "Internal server error" } };
    }
  });
}
