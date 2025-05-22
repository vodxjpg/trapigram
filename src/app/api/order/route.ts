import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Pool } from "pg";
import { v4 as uuidv4 } from "uuid";
import crypto from "crypto";
import { getContext } from "@/lib/context";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

/* ------------------------------------------------------------------ */
/*  Encryption helpers                                                */
/* ------------------------------------------------------------------ */
const ENC_KEY_B64 = process.env.ENCRYPTION_KEY || "";
const ENC_IV_B64  = process.env.ENCRYPTION_IV  || "";

function getEncryptionKeyAndIv(): { key: Buffer; iv: Buffer } {
  const key = Buffer.from(ENC_KEY_B64, "base64");
  const iv  = Buffer.from(ENC_IV_B64, "base64");
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
/* GET – single order (orderKey) or list orders                       */
/* ================================================================== */
export async function GET(req: NextRequest) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { organizationId } = ctx;

  const { searchParams } = new URL(req.url);
  const filterOrderKey = searchParams.get("orderKey");
  const filterClientId = searchParams.get("clientId");

  try {
    // 1) Fetch one by orderKey
    if (filterOrderKey) {
      const sql = `
        SELECT o.*,
               c."firstName",
               c."lastName",
               c."username",
               c.email
        FROM   orders o
        JOIN   clients c ON c.id = o."clientId"
        WHERE  o."organizationId" = $1
          AND  o."orderKey"       = $2
        LIMIT  1
      `;
      const res = await pool.query(sql, [organizationId, filterOrderKey]);
      if (res.rowCount === 0) {
        return NextResponse.json({ error: "Order not found" }, { status: 404 });
      }
      return NextResponse.json(res.rows[0], { status: 200 });
    }

    // 2) Fetch all orders for a specific client
    if (filterClientId) {
      const sql = `
        SELECT o.*,
               c."firstName",
               c."lastName",
               c."username",
               c.email
        FROM   orders o
        JOIN   clients c ON c.id = o."clientId"
        WHERE  o."organizationId" = $1
          AND  o."clientId"       = $2
      `;
      const res = await pool.query(sql, [organizationId, filterClientId]);
      const orders = res.rows.map((o) => ({
        id:        o.id,
        orderKey:  o.orderKey,
        status:    o.status,
        createdAt: o.createdAt,
        total:     Number(o.totalAmount),
        firstName: o.firstName,
        lastName:  o.lastName,
        username:  o.username,
        email:     o.email,
      }));
      return NextResponse.json(orders, { status: 200 });
    }

    // 3) List all orders in this organization
    const listSql = `
      SELECT o.*,
             c."firstName",
             c."lastName",
             c."username",
             c.email
      FROM   orders o
      JOIN   clients c ON c.id = o."clientId"
      WHERE  o."organizationId" = $1
    `;
    const listRes = await pool.query(listSql, [organizationId]);
    const orders = listRes.rows.map((o) => ({
      id:        o.id,
      orderKey:  o.orderKey,
      status:    o.status,
      createdAt: o.createdAt,
      total:     Number(o.totalAmount),
      firstName: o.firstName,
      lastName:  o.lastName,
      username:  o.username,
      email:     o.email,
    }));

    return NextResponse.json(orders, { status: 200 });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
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

  const orderId  = uuidv4();


  /* ---------- ensure sequence & generate sequential orderKey ------ */
  await pool.query(`
    CREATE SEQUENCE IF NOT EXISTS order_key_seq
    START 1
    INCREMENT 1
    OWNED BY NONE
  `);
  const seqRes = await pool.query(`SELECT nextval('order_key_seq') AS seq`);
  const seqNum = Number(seqRes.rows[0].seq);
  const orderKey = String(seqNum).padStart(3, "0");   // 001, 002 … 999, 1000 …

  const encryptedAddress = encryptSecretNode(address);
  const shippingMethod   = `${shippingMethodTitle} - ${shippingMethodDescription}`;
  const orderStatus      = "open";
  const cartStatus       = false;

  /* ---------- prepare order INSERT ------------------------------ */
  const insertSQL = `
    INSERT INTO orders
      (id, "orderKey", "clientId", "organizationId", "cartId", country,
       "paymentMethod", "shippingTotal", "discountTotal",
       "totalAmount", "couponCode", "shippingService", "shippingMethod",
       address, status, "cartHash",
       "dateCreated", "createdAt", "updatedAt")
    VALUES
      ($1, $2, $3, $4, $5, $6,
       $7, $8, $9,
       $10, $11, $12, $13,
       $14, $15, $16,
       NOW(), NOW(), NOW())
    RETURNING *
  `;
  const insertValues = [
    orderId,
    orderKey,
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
      SELECT ws.quantity, p."allowBackorders"
      FROM   "warehouseStock" ws
      JOIN   products p ON p.id = ws."productId"
      WHERE  ws."productId" = $1
        AND  ws.country     = $2
      LIMIT  1
    `;
    const stockResult = await pool.query(stockQuery, [cp.productId, country]);
    const row = stockResult.rows[0] || { quantity: 0, allowBackorders: false };

    const available     = Number(row.quantity);
    const canBackorder  = Boolean(row.allowBackorders);

    if (!canBackorder && cp.quantity > available) {
      outOfStock.push({
        productId:  cp.productId,
        requested:  cp.quantity,
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

    /* -------- decrement stock (respecting backorder) --------------- */
    for (const cp of cartProductsResults.rows) {
      const decSQL = `
        UPDATE "warehouseStock" ws
        SET quantity = CASE
                         WHEN p."allowBackorders" = TRUE
                           THEN GREATEST(ws.quantity - $1, 0)
                         ELSE ws.quantity - $1
                       END,
            "updatedAt" = NOW()
        FROM products p
        WHERE ws."productId" = $2
          AND ws.country     = $3
          AND p.id           = ws."productId"
          AND (
            p."allowBackorders" = TRUE
            OR ws.quantity >= $1
          )
        RETURNING ws.quantity
      `;
      const res = await pool.query(decSQL, [cp.quantity, cp.productId, country]);
      if (res.rowCount === 0) {
        throw new Error(`Insufficient stock for product ${cp.productId}`);
      }
    }

    /* -------- finalise cart & order ------------------------------- */
    await pool.query(updateCartSQL, updateCartValues);
    const orderRes = await pool.query(insertSQL, insertValues);

    await pool.query("COMMIT");
    return NextResponse.json(orderRes.rows[0], { status: 201 });
  } catch (error: any) {
    await pool.query("ROLLBACK");
    console.error("[POST /api/order] error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
