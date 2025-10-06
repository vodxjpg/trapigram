// src/app/api/cart/[id]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { pgPool as pool } from "@/lib/db";
import { getContext } from "@/lib/context";
import { resolveUnitPrice } from "@/lib/pricing";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;

  try {
    const { id } = await params;

    /* 1) Load cart + client */
    const cartRes = await pool.query(`SELECT * FROM carts WHERE id=$1`, [id]);
    if (!cartRes.rowCount)
      return NextResponse.json({ error: "Cart not found" }, { status: 404 });
    const cart = cartRes.rows[0];

    // (Your previous coupon clear)
    await pool.query(`UPDATE carts SET "couponCode" = NULL WHERE id = $1`, [id]);

    const clientRes = await pool.query(
      `SELECT country,"levelId" FROM clients WHERE id=$1`,
      [cart.clientId]
    );
    const client = clientRes.rows[0];

    /* 2) Re-price if the client’s country changed (unchanged, but shortened) */
    if (cart.country !== client.country) {
      const tx = await pool.connect();
      try {
        const removedItems: { productId: string; reason: string }[] = [];
        await tx.query("BEGIN");
        await tx.query(`UPDATE carts SET country=$1 WHERE id=$2`, [client.country, id]);

        const { rows: lines } = await tx.query<{
          id: string;
          productId: string;
          variationId: string | null;
          quantity: number;
        }>(
          `SELECT id,"productId","variationId",quantity
             FROM "cartProducts" WHERE "cartId"=$1`,
          [id],
        );

        for (const line of lines) {
          try {
            const vId = (typeof line.variationId === "string" && line.variationId.trim()) ? line.variationId : null;
            const { price } = await resolveUnitPrice(
              line.productId,
              vId,
              client.country,
              client.levelId,
            );
            await tx.query(
              `UPDATE "cartProducts"
                 SET "unitPrice" = $1, "updatedAt" = NOW()
               WHERE id = $2`,
              [price, line.id],
            );
          } catch (err: any) {
            if (err.message?.startsWith?.("No money price for")) {
              await tx.query(`DELETE FROM "cartProducts" WHERE id = $1`, [line.id]);
              removedItems.push({ productId: line.productId, reason: err.message });
              continue;
            }
            throw err;
          }
        }

        await tx.query("COMMIT");
        // stash removedItems in a temp table row so we can fetch later (no hacks on pool)
        await pool.query(
          `INSERT INTO "cartTmpRemoved"
             ("cartId","payload","createdAt")
           VALUES ($1, $2, NOW())
           ON CONFLICT ("cartId")
           DO UPDATE SET "payload" = EXCLUDED."payload", "createdAt" = NOW()`,
          [id, JSON.stringify(removedItems)]
        );
      } catch (e) {
        await tx.query("ROLLBACK");
        throw e;
      } finally {
        tx.release();
      }
    }

    /* 3) Fetch lines (NORMAL + AFFILIATE), include variation join */
    const baseSelect = `
      SELECT
        p.id,
        p.title,
        p.description,
        COALESCE(v.image, p.image) AS image,
        COALESCE(v.sku,   p.sku)   AS sku,
        cp.quantity,
        cp."unitPrice",
        cp."variationId",
        cp."createdAt",
        v.attributes AS "variantAttributes",
        false AS "isAffiliate"
      FROM products p
      JOIN "cartProducts" cp ON p.id = cp."productId"
      LEFT JOIN "productVariations" v ON v.id = cp."variationId"
      WHERE cp."cartId" = $1
    `;

    const affSelect = `
      SELECT
        ap.id,
        ap.title,
        ap.description,
        ap.image,
        ap.sku,
        cp.quantity,
        cp."unitPrice",
        cp."variationId",
        cp."createdAt",
        NULL::jsonb AS "variantAttributes",
        true AS "isAffiliate"
      FROM "affiliateProducts" ap
      JOIN "cartProducts" cp ON ap.id = cp."affiliateProductId"
      WHERE cp."cartId" = $1
    `;

    const [prod, aff] = await Promise.all([
      pool.query(baseSelect, [id]),
      pool.query(affSelect, [id]),
    ]);

    const rows = [...prod.rows, ...aff.rows];

    /* 3b) Build variant label maps (attribute/term → names) */
    // Collect ids from variation attributes
    const attrIds = new Set<string>();
    const termIds = new Set<string>();
    for (const r of rows) {
      if (!r.variantattributes) continue;
      const attrs = typeof r.variantattributes === "string"
        ? JSON.parse(r.variantattributes || "{}")
        : (r.variantattributes || {});
      for (const [attrId, termId] of Object.entries(attrs)) {
        if (attrId) attrIds.add(String(attrId));
        if (termId != null) termIds.add(String(termId));
      }
    }

    const attrNameRows = attrIds.size
      ? await pool.query(
          `SELECT id, name FROM "productAttributes" WHERE id = ANY($1::text[])`,
          [Array.from(attrIds)]
        )
      : { rows: [] as any[] };

    const termNameRows = termIds.size
      ? await pool.query(
          `SELECT id, name FROM "productAttributeTerms" WHERE id = ANY($1::text[])`,
          [Array.from(termIds)]
        )
      : { rows: [] as any[] };

    const ATTR_NAME: Record<string, string> = Object.fromEntries(
      attrNameRows.rows.map((r: any) => [String(r.id), String(r.name)])
    );
    const TERM_NAME: Record<string, string> = Object.fromEntries(
      termNameRows.rows.map((r: any) => [String(r.id), String(r.name)])
    );

    const variantLabelOf = (attrs: any): string => {
      if (!attrs) return "";
      const obj = typeof attrs === "string" ? JSON.parse(attrs || "{}") : attrs;
      const pairs = Object.entries(obj);
      if (!pairs.length) return "";
      return pairs
        .map(([attrId, termId]) => {
          const an = ATTR_NAME[String(attrId)] ?? String(attrId);
          const tn = TERM_NAME[String(termId)] ?? String(termId);
          return `${an} ${tn}`;
        })
        .join(", ");
    };

    /* 3c) Finalize lines (adds titleWithVariant, variantLabel) */
    const lines = rows
      .map((l: any) => {
        const unitPrice = Number(l.unitprice);
        const quantity = Number(l.quantity);
        const variantLabel = variantLabelOf(l.variantattributes);
        const titleWithVariant = variantLabel ? `${l.title} - ${variantLabel}` : l.title;
        return {
          ...l,
          unitPrice,
          subtotal: unitPrice * quantity,
          variantLabel,
          titleWithVariant,
        };
      })
      .sort((a: any, b: any) => new Date(a.createdat).getTime() - new Date(b.createdat).getTime());

    /* 3d) pull removedItems left by the re-price transaction */
    let removedItems: { productId: string; reason: string }[] = [];
    const tmp = await pool.query(
      `SELECT "payload" FROM "cartTmpRemoved" WHERE "cartId" = $1`,
      [id]
    );
    if (tmp.rowCount) {
      try { removedItems = JSON.parse(tmp.rows[0].payload || "[]"); } catch {}
      // clean up so we don’t keep re-sending
      await pool.query(`DELETE FROM "cartTmpRemoved" WHERE "cartId" = $1`, [id]);
    }

    /* 4) Respond (legacy + new keys) */
    return NextResponse.json(
      {
        // legacy
        resultCartProducts: lines,
        // new
        lines,
        removedItems,
      },
      { status: 200 },
    );
  } catch (error: any) {
    console.error("[GET /api/cart/:id]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
