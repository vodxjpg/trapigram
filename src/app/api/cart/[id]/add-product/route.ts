import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Pool } from "pg";
import { v4 as uuidv4 } from "uuid";
import crypto from "crypto";
import { getContext } from "@/lib/context";
import { resolveUnitPrice } from "@/lib/pricing";
import { adjustStock }   from "@/lib/stock";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const cartProductSchema = z.object({
  productId: z.string(),
  quantity: z.number().int().positive()
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;

  try {
    const { id: cartId } = await params;
    const body           = cartProductSchema.parse(await req.json());

    /* 1️⃣  client country + level */
    const { rows: clientRows } = await pool.query(
      `SELECT clients.country   AS country,
              clients."levelId" AS "levelId"
       FROM clients
       JOIN carts ON carts."clientId" = clients.id
       WHERE carts.id = $1`,
      [cartId]
    );
    if (!clientRows.length)
      return NextResponse.json({ error: "Cart or client not found" }, { status: 404 });

    const { country, levelId } = clientRows[0];

    /* 2️⃣  price resolution */
    const { price, isAffiliate } = await resolveUnitPrice(
      body.productId,
      country,
      levelId
    );

    /* 3️⃣  upsert cartProducts */
      const existing = await pool.query(
          `SELECT id, quantity
             FROM "cartProducts"
            WHERE "cartId" = $1
              AND ${isAffiliate ? `"affiliateProductId"` : `"productId"`} = $2`,
          [cartId, body.productId]
        );

    let quantity = body.quantity;
    if (existing.rowCount) {
      quantity += existing.rows[0].quantity;
      await pool.query(
        `UPDATE "cartProducts"
         SET quantity=$1,"unitPrice"=$2,"updatedAt"=NOW()
         WHERE id=$3`,
        [quantity, price, existing.rows[0].id]
      );
    } else {
           await pool.query(
               `INSERT INTO "cartProducts"
                  (id,"cartId","productId","affiliateProductId",
                   quantity,"unitPrice","createdAt","updatedAt")
                VALUES ($1,$2,$3,$4,$5,$6,NOW(),NOW())`,
               [
                 uuidv4(),
                 cartId,
                 isAffiliate ? null        : body.productId,
                 isAffiliate ? body.productId : null,
                 quantity,
                 price
               ]
             );
    }
    /* 3b️⃣  reserve the JUST-ADDED quantity */
    await adjustStock(pool, body.productId, country, -body.quantity);

    /* 4️⃣  refresh cart hash */
    const rowsHash = await pool.query(
       `SELECT COALESCE("productId","affiliateProductId") AS pid,
       quantity,"unitPrice"
       FROM "cartProducts"
       WHERE "cartId"=$1`,
      [cartId]
    );
    const newHash = crypto.createHash("sha256")
                          .update(JSON.stringify(rowsHash.rows))
                          .digest("hex");
    await pool.query(
      `UPDATE carts
       SET "cartUpdatedHash"=$1,"updatedAt"=NOW()
       WHERE id=$2`,
      [newHash, cartId]
    );

    /* 5️⃣  return full product with expected fields */
    const prodQuery = isAffiliate
      ? `SELECT id,title,description,image,sku
         FROM "affiliateProducts"
         WHERE id = $1`
      : `SELECT id,title,description,image,sku,"regularPrice"
         FROM products
         WHERE id = $1`;
    const { rows: prodRows } = await pool.query(prodQuery, [body.productId]);
    if (!prodRows.length)
      return NextResponse.json({ error: "Product not found after insert" }, { status: 500 });

    const base = prodRows[0];

    const product = {
      id          : base.id,
      title       : base.title,
      sku         : base.sku,
      description : base.description,
      image       : base.image,
      regularPrice: isAffiliate ? {} : base.regularPrice ?? {},
      price       : Number(price),          // ← for UI fallback
      stockData   : {},                     // satisfies component shape
      subtotal    : Number(price) * quantity
    };

    return NextResponse.json({ product, quantity }, { status: 201 });
  } catch (err: any) {
    console.error("[POST /api/cart/:id/add-product]", err);
    if (err instanceof z.ZodError)
      return NextResponse.json({ error: err.errors }, { status: 400 });
    return NextResponse.json({ error: err.message ?? "Internal server error" }, { status: 500 });
  }
}
