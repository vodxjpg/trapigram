// src/app/api/order/route.ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Pool } from "pg";
import { v4 as uuidv4 } from "uuid";
import crypto from "crypto";
import { getContext } from "@/lib/context";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

const ENC_KEY_B64 = process.env.ENCRYPTION_KEY || "";
const ENC_IV_B64 = process.env.ENCRYPTION_IV || "";

function getEncryptionKeyAndIv(): { key: Buffer; iv: Buffer } {
  const key = Buffer.from(ENC_KEY_B64, "base64");
  const iv = Buffer.from(ENC_IV_B64, "base64");
  if (!ENC_KEY_B64 || !ENC_IV_B64) {
    throw new Error("ENCRYPTION_KEY or ENCRYPTION_IV not set in environment");
  }
  if (key.length !== 32) {
    throw new Error(
      `Invalid ENCRYPTION_KEY: must decode to 32 bytes, got ${key.length}`,
    );
  }
  if (iv.length !== 16) {
    throw new Error(
      `Invalid ENCRYPTION_IV: must decode to 16 bytes, got ${iv.length}`,
    );
  }
  return { key, iv };
}

function encryptSecretNode(plain: string): string {
  const { key, iv } = getEncryptionKeyAndIv();
  const cipher = crypto.createCipheriv("aes-256-cbc", key, iv);
  let encrypted = cipher.update(plain, "utf8", "base64");
  encrypted += cipher.final("base64");
  return encrypted;
}

/* ------------------------------------------------------------------ */
/*  Zod – order payload                                               */
/* ------------------------------------------------------------------ */
const orderSchema = z.object({
  organization: z.string(),
  clientId: z.string().uuid(),
  cartId: z.string().uuid(),
  country: z.string().length(2),
  paymentMethod: z.string().min(1),
  shippingAmount: z.coerce.number().min(0),
  shippingMethodTitle: z.string(),
  shippingMethodDescription: z.string(),
  discountAmount: z.coerce.number().min(0),
  totalAmount: z.coerce.number().min(0),
  couponCode: z.string().optional().nullable(),
  shippingCompany: z.string().min(1),
  address: z.string().min(1),
  counponType: z.string(),
});
type OrderPayload = z.infer<typeof orderSchema>;

/* ================================================================== */
/* GET – list orders                                                  */
/* ================================================================== */
export async function GET(req: NextRequest) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { organizationId } = ctx;

  try {
    const getOrder = `
      SELECT 
        o.*,
        c."firstName",
        c."lastName",
        c."username",
        c.email
      FROM orders AS o
      JOIN clients AS c ON o."clientId" = c.id
      WHERE o."organizationId" = $1
    `;
    const resultOrder = await pool.query(getOrder, [organizationId]);
    const orders = resultOrder.rows;

    const sampleOrders = orders.map((o) => ({
      id: o.id,
      status: o.status,
      createdAt: o.createdAt,
      total: Number(o.totalAmount),
      firstName: o.firstName,
      lastName: o.lastName,
      username: o.username,
      email: o.email,
    }));

    return NextResponse.json(sampleOrders, { status: 201 });
  } catch (error) {
    return NextResponse.json(error, { status: 403 });
  }
}

/* ================================================================== */
/* POST – create order                                                */
/* ================================================================== */
export async function POST(req: NextRequest) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { organizationId } = ctx;

  /* ---------- parse & validate body ----------------------------- */
  let payload: OrderPayload;
  try {
    const body = await req.json();
    body.organization = organizationId;
    body.totalAmount = body.subtotal - body.discountAmount + body.shippingAmount;
    payload = orderSchema.parse(body);
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.errors }, { status: 400 });
    }
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const {
    organization,
    clientId,
    cartId,
    country,
    paymentMethod,
    shippingAmount,
    shippingMethodTitle,
    shippingMethodDescription,
    discountAmount,
    totalAmount,
    couponCode,
    shippingCompany,
    address,
  } = payload;

  const orderId = uuidv4();
  const encryptedAddress = encryptSecretNode(address);
  const shippingMethod = `${shippingMethodTitle} - ${shippingMethodDescription}`;
  const orderStatus = "open";
  const cartStatus = false;

  /* ---------- prepare order INSERT ------------------------------ */
  const insertSQL = `
    INSERT INTO orders
      (id, "clientId", "organizationId", "cartId", country,
       "paymentMethod", "shippingTotal", "discountTotal",
       "totalAmount", "couponCode", "shippingService", "shippingMethod",
       address, status, "cartHash", "dateCreated",
       "createdAt", "updatedAt")
    VALUES
      ($1, $2, $3, $4, $5,
       $6, $7, $8,
       $9, $10, $11, $12,
       $13, $14, $15,
       NOW(), NOW(), NOW())
    RETURNING *
  `;
  const insertValues = [
    orderId,
    clientId,
    organization,
    cartId,
    country,
    paymentMethod,
    shippingAmount,
    discountAmount,
    totalAmount,
    couponCode,
    shippingCompany,
    shippingMethod,
    encryptedAddress,
    orderStatus,
    /* cartHash pushed below */
  ];

  /* ---------- update cart hash ---------------------------------- */
  const cartHash = encryptSecretNode(JSON.stringify(insertValues));
  insertValues.push(cartHash);
  const updateCartSQL = `
    UPDATE carts
    SET status = $1, "updatedAt" = NOW(), "cartHash" = $2
    WHERE id = $3
    RETURNING *
  `;
  const updateCartValues = [cartStatus, cartHash, cartId];

  /* ---------- fetch cart products ------------------------------- */
  const cartProductsQuery = `
    SELECT * FROM "cartProducts"
    WHERE "cartId" = $1
  `;
  const cartProductsResults = await pool.query(cartProductsQuery, [cartId]);

  /* ---------- stock availability check (with back-order) -------- */
  const outOfStock: Array<{
    productId: string;
    requested: number;
    available: number;
  }> = [];

  for (const cp of cartProductsResults.rows) {
    const stockQuery = `
      SELECT ws.quantity,
             p."allowBackorders"
      FROM   "warehouseStock" ws
      JOIN   products p ON p.id = ws."productId"
      WHERE  ws."productId" = $1
        AND  ws.country     = $2
      LIMIT  1
    `;
    const stockResult = await pool.query(stockQuery, [cp.productId, country]);
    const row = stockResult.rows[0] || { quantity: 0, allowBackorders: false };

    const available = Number(row.quantity);
    const canBackorder = Boolean(row.allowBackorders);

    if (!canBackorder && cp.quantity > available) {
      outOfStock.push({
        productId: cp.productId,
        requested: cp.quantity,
        available,
      });
    }
  }

  if (outOfStock.length) {
    return NextResponse.json(
      { error: "Products out of stock", products: outOfStock },
      { status: 400 },
    );
  }

  /* ================================================================= */
  /*  transactional write – safe against concurrent races              */
  /* ================================================================= */
  try {
    await pool.query("BEGIN");


    /* -------- decrement stock, never going negative if backorders allowed --------- */
    for (const cp of cartProductsResults.rows) {
      const decrementSQL = `
      UPDATE "warehouseStock" AS ws
      SET
        quantity   = CASE
                       WHEN p."allowBackorders" = TRUE
                         THEN GREATEST(ws.quantity - $1, 0)
                       ELSE ws.quantity - $1
                     END,
        "updatedAt" = NOW()
      FROM products p
      WHERE
        ws."productId" = $2
        AND ws.country = $3
        AND p.id        = ws."productId"
        AND (
          -- for no-backorder items require enough stock
          p."allowBackorders" = TRUE
          OR ws.quantity >= $1
        )
      RETURNING ws.quantity, p."allowBackorders"
    `;
      const decRes = await pool.query(decrementSQL, [
        cp.quantity,
        cp.productId,
        country,
      ]);
      if (decRes.rowCount === 0) {
        throw new Error(
          `Insufficient stock for product ${cp.productId} during commit`
        );
      }
    }

    /* -------- finalise cart & order ----------------------------- */
    await pool.query(updateCartSQL, updateCartValues);
    const orderRes = await pool.query(insertSQL, insertValues);
    await pool.query("COMMIT");

    return NextResponse.json(orderRes.rows[0], { status: 201 });
  } catch (error: any) {
    await pool.query("ROLLBACK");
    console.error("[POST /api/order] error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
