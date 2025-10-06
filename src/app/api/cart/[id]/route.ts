// src/app/api/cart/[id]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { pgPool as pool } from "@/lib/db";
import { getContext } from "@/lib/context";
import { resolveUnitPrice } from "@/lib/pricing";

type CartLineRow = {
  id: string;
  title: string;
  description: string | null;
  image: string | null;
  sku: string | null;
  quantity: number;
  unitPrice: number;
  variationId: string | null;
  createdAt: string | Date;
  isAffiliate: boolean;
  varAttributes: any | null; // JSON from productVariations.attributes
};

function parseJson<T>(val: any): T | null {
  if (val == null) return null;
  if (typeof val === "object") return val as T;
  if (typeof val === "string") {
    try {
      return JSON.parse(val) as T;
    } catch {
      return null;
    }
  }
  return null;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;

  try {
    const { id } = await params;

    /* 1. Load cart + client */
    const cartRes = await pool.query(`SELECT * FROM carts WHERE id=$1`, [id]);
    if (!cartRes.rowCount)
      return NextResponse.json({ error: "Cart not found" }, { status: 404 });
    const cart = cartRes.rows[0];
    await pool.query(`UPDATE carts SET "couponCode" = NULL WHERE id = $1`, [id]);

    const clientRes = await pool.query(
      `SELECT country,"levelId" FROM clients WHERE id=$1`,
      [cart.clientId]
    );
    const client = clientRes.rows[0];

    /* 2. Re-price if the client’s country changed (kept intact) */
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
             FROM "cartProducts"
            WHERE "cartId"=$1`,
          [id]
        );

        for (const line of lines) {
          try {
            const vId =
              typeof line.variationId === "string" && line.variationId.trim().length > 0
                ? line.variationId
                : null;

            const { price } = await resolveUnitPrice(
              line.productId,
              vId,
              client.country,
              client.levelId
            );

            await tx.query(
              `UPDATE "cartProducts"
                  SET "unitPrice" = $1, "updatedAt" = NOW()
                WHERE id = $2`,
              [price, line.id]
            );
          } catch (err: any) {
            if (typeof err?.message === "string" && err.message.startsWith("No money price for")) {
              await tx.query(`DELETE FROM "cartProducts" WHERE id = $1`, [line.id]);
              removedItems.push({ productId: line.productId, reason: err.message });
              continue;
            }
            throw err;
          }
        }

        await tx.query("COMMIT");
        // NOTE: We keep the original structure/variables. If you want to surface removedItems
        // to the caller, you can wire this up to your state layer; not changing existing behavior here.
        (tx as any).removedItems = removedItems;
      } catch (e) {
        await tx.query("ROLLBACK");
        throw e;
      } finally {
        tx.release();
      }
    }

    /* 3. Assemble normal + affiliate products with variation attributes */
    // LEFT JOIN productVariations to pick up attributes for variation lines
    const prodQ = `
      SELECT
        p.id,
        p.title,
        p.description,
        p.image,
        p.sku,
        cp.quantity,
        cp."unitPrice",
        cp."variationId",
        cp."createdAt",
        v.attributes AS "varAttributes",
        false AS "isAffiliate"
      FROM products p
      JOIN "cartProducts" cp ON p.id = cp."productId"
      LEFT JOIN "productVariations" v ON v.id = cp."variationId"
      WHERE cp."cartId" = $1
    `;

    const affQ = `
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
        v.attributes AS "varAttributes",
        true AS "isAffiliate"
      FROM "affiliateProducts" ap
      JOIN "cartProducts" cp ON ap.id = cp."affiliateProductId"
      LEFT JOIN "productVariations" v ON v.id = cp."variationId"
      WHERE cp."cartId" = $1
    `;

    const [prod, aff] = await Promise.all([
      pool.query<CartLineRow>(prodQ, [id]),
      pool.query<CartLineRow>(affQ, [id]),
    ]);

    const rawLines: CartLineRow[] = [...prod.rows, ...aff.rows].sort(
      (a, b) => new Date(a.createdAt as any).getTime() - new Date(b.createdAt as any).getTime()
    );

    // Collect attribute/term ids referenced by variation attributes on these lines
    const attrIds = new Set<string>();
    const termIds = new Set<string>();

    for (const l of rawLines) {
      const attrs = parseJson<Record<string, string>>(l.varAttributes);
      if (!attrs) continue;
      for (const [attributeId, termId] of Object.entries(attrs)) {
        if (attributeId) attrIds.add(attributeId);
        if (termId) termIds.add(String(termId));
      }
    }

    // Build name maps (only if needed)
    let ATTR_NAME: Record<string, string> = {};
    let TERM_NAME: Record<string, string> = {};

    if (attrIds.size) {
      const attrRows = await pool.query<{ id: string; name: string }>(
        `SELECT id, name FROM "productAttributes" WHERE id = ANY($1::text[])`,
        [Array.from(attrIds)]
      );
      ATTR_NAME = Object.fromEntries(attrRows.rows.map((r) => [r.id, r.name]));
    }

    if (termIds.size) {
      const termRows = await pool.query<{ id: string; name: string }>(
        `SELECT id, name FROM "productAttributeTerms" WHERE id = ANY($1::text[])`,
        [Array.from(termIds)]
      );
      TERM_NAME = Object.fromEntries(termRows.rows.map((r) => [r.id, r.name]));
    }

    // Build final lines with title including variation label if present
    const lines = rawLines.map((l) => {
      const attrs = parseJson<Record<string, string>>(l.varAttributes);
      let finalTitle = l.title;

      if (l.variationId && attrs && Object.keys(attrs).length) {
        // Compose readable label like "Color RED, Size XL"
        const pairs = Object.entries(attrs);
        const variantLabel = pairs
          .map(([attributeId, termId]) => {
            const aName = ATTR_NAME[attributeId] ?? attributeId;
            const tName = TERM_NAME[String(termId)] ?? String(termId);
            return `${aName} ${tName}`;
          })
          .join(", ");

        if (variantLabel) finalTitle = `${l.title} - ${variantLabel}`;
      }

      return {
        ...l,
        title: finalTitle, // override visible title with variant-aware one
        unitPrice: Number(l.unitPrice),
        subtotal: Number(l.unitPrice) * l.quantity,
      };
    });

    // Keep removedItems behavior consistent with existing code (not wired to tx context here)
    const removedItems =
      (await pool as any).removedItems as { productId: string; reason: string }[] || [];

    /* 4. Return both legacy and new keys (unchanged shape, enriched title) */
    return NextResponse.json(
      {
        resultCartProducts: lines,
        lines,
        removedItems,
      },
      { status: 200 }
    );
  } catch (error: any) {
    console.error("[GET /api/cart/:id]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
