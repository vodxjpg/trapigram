// src/app/api/order/route.ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Pool } from "pg";
import { v4 as uuidv4 } from "uuid";
import crypto from "crypto";
import { getContext } from "@/lib/context";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

/* ------------------------------------------------------------------ */
/*  Encryption helpers                                                */
/* ------------------------------------------------------------------ */
const ENC_KEY_B64 = process.env.ENCRYPTION_KEY || "";
const ENC_IV_B64 = process.env.ENCRYPTION_IV || "";

function getEncryptionKeyAndIv(): { key: Buffer; iv: Buffer } {
  const key = Buffer.from(ENC_KEY_B64, "base64");
  const iv = Buffer.from(ENC_IV_B64, "base64");
  if (!ENC_KEY_B64 || !ENC_IV_B64) throw new Error("ENCRYPTION_* env vars missing");
  if (key.length !== 32) throw new Error("ENCRYPTION_KEY must decode to 32 bytes");
  if (iv.length !== 16) throw new Error("ENCRYPTION_IV must decode to 16 bytes");
  return { key, iv };
}
function encryptSecretNode(plain: string): string {
  const { key, iv } = getEncryptionKeyAndIv();
  const cipher = crypto.createCipheriv("aes-256-cbc", key, iv);
  return cipher.update(plain, "utf8", "base64") + cipher.final("base64");
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
  subtotal: z.coerce.number().min(0),
  couponCode: z.string().nullable().optional(),
  couponType: z.string().nullable().optional(),
  counponType: z.string().nullable().optional(), // legacy typo
  shippingCompany: z.string().nullable().optional(),
  address: z.string().min(1),
  trackingNumber: z.string().nullable().optional(),
  discountValue: z.coerce.number().min(0),
});
type OrderPayload = z.infer<typeof orderSchema>;

/* ================================================================== */
/* GET – single / list                                                */
/* ================================================================== */
export async function GET(req: NextRequest) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { organizationId } = ctx;

  const { searchParams } = new URL(req.url);
  const filterOrderKey = searchParams.get("orderKey");
  const filterClientId = searchParams.get("clientId");

  try {
    /* 1) Single order ------------------------------------------------- */
    if (filterOrderKey) {
      const sql = `
        SELECT o.*, c."firstName", c."lastName", c."username", c.email
        FROM   orders o
        JOIN   clients c ON c.id = o."clientId"
        WHERE  o."organizationId" = $1 AND o."orderKey" = $2
        LIMIT  1
      `;
      const r = await pool.query(sql, [organizationId, filterOrderKey]);
      if (!r.rowCount) return NextResponse.json({ error: "Order not found" }, { status: 404 });
      return NextResponse.json(r.rows[0], { status: 200 });
    }

    /* 2) Orders by client -------------------------------------------- */
    if (filterClientId) {
      const sql = `
        SELECT o.*, c."firstName", c."lastName", c."username", c.email
        FROM   orders o
        JOIN   clients c ON c.id = o."clientId"
        WHERE  o."organizationId" = $1 AND o."clientId" = $2
      `;
      const r = await pool.query(sql, [organizationId, filterClientId]);
      const orders = r.rows.map(o => ({
        id: o.id,
        orderKey: o.orderKey,
        status: o.status,
        createdAt: o.createdAt,
        total: Number(o.totalAmount),
        trackingNumber: o.trackingNumber,
        firstName: o.firstName,
        lastName: o.lastName,
        username: o.username,
        email: o.email,
      }));
      return NextResponse.json(orders, { status: 200 });
    }

    /* 3) Full list ---------------------------------------------------- */
    const listSql = `
      SELECT o.*, c."firstName", c."lastName", c."username", c.email
      FROM   orders o
      JOIN   clients c ON c.id = o."clientId"
      WHERE  o."organizationId" = $1
    `;
    const r = await pool.query(listSql, [organizationId]);
    const orders = r.rows.map(o => ({
      id: o.id,
      orderKey: o.orderKey,
      status: o.status,
      createdAt: o.createdAt,
      total: Number(o.totalAmount),
      trackingNumber: o.trackingNumber,
      firstName: o.firstName,
      lastName: o.lastName,
      username: o.username,
      email: o.email,
    }));
    return NextResponse.json(orders, { status: 200 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

/* ================================================================== */
/* POST – create order                                                */
/* ================================================================== */
export async function POST(req: NextRequest) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { organizationId } = ctx;

  /* ---------- validate body --------------------------------------- */
  let payload: OrderPayload;
  try {
    const body = await req.json();
    body.organization = organizationId;
    body.totalAmount = body.subtotal - body.discountAmount + body.shippingAmount;
    payload = orderSchema.parse(body);
  } catch (err) {
    if (err instanceof z.ZodError)
      return NextResponse.json({ error: err.errors }, { status: 400 });
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  /* ---------- destructure ----------------------------------------- */
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
    couponType,
    counponType,
    shippingCompany,
    address,
    trackingNumber = null,
    subtotal,
    discountValue
  } = payload;
  const couponTypeResolved = couponType ?? counponType ?? null;

  const orderId = uuidv4();

  /* ---------- sequential orderKey --------------------------------- */
  await pool.query(`CREATE SEQUENCE IF NOT EXISTS order_key_seq START 1 INCREMENT 1 OWNED BY NONE`);
  const seq = await pool.query(`SELECT nextval('order_key_seq') AS seq`);
  const orderKey = String(Number(seq.rows[0].seq)).padStart(3, "0");

  const encryptedAddress = encryptSecretNode(address);
  const shippingMethod = `${shippingMethodTitle} - ${shippingMethodDescription}`;
  const orderStatus = "open";
  const cartStatus = false;

  /* ---------- INSERT ---------------------------------------------- */
  const insertSQL = `
    INSERT INTO orders
      (id, "clientId", "organizationId",
       "cartId", country, "paymentMethod",
       "shippingTotal", "discountTotal", "totalAmount",
       "couponCode", "couponType", "shippingService", "shippingMethod",
       "trackingNumber", address, status, subtotal, "discountValue", "cartHash",
       "dateCreated", "createdAt", "updatedAt", "orderKey")
    VALUES
      ($1,$2,$3,
       $4,$5,$6,
       $7,$8,$9,
       $10,$11,$12,$13,
       $14,$15,$16,$17,$18,$19,
       NOW(),NOW(),NOW(),$20)
    RETURNING *
  `;
  /* ---------- build the list up to $17 (no cartHash yet) ---------- */
  const baseValues: unknown[] = [
    orderId,                // $1
    clientId,               // $2
    organization,           // $3
    cartId,                 // $4
    country,                // $5
    paymentMethod,          // $6
    shippingAmount,         // $7
    discountAmount,         // $8
    totalAmount,            // $9
    couponCode,             // $10
    couponTypeResolved,     // $11
    shippingCompany,        // $12
    shippingMethod,         // $13
    trackingNumber,         // $14
    encryptedAddress,       // $15
    orderStatus,            // $16
    subtotal,               // $17
    discountValue,          // $18
  ];

  /* ---------- compute cartHash from the SAME list ----------------- */
  const cartHash = encryptSecretNode(JSON.stringify(baseValues));

  /* ---------- final values exactly matching $1…$19 ---------------- */
  const insertValues = [...baseValues, cartHash, orderKey]; // $18, $19

  const updCartSQL = `
    UPDATE carts
    SET status = $1, "updatedAt" = NOW(), "cartHash" = $2
    WHERE id = $3
  `;
  const updCartVals = [cartStatus, cartHash, cartId];

  /* ---------- transaction ---------------------------------------- */
  try {
    await pool.query("BEGIN");
    await pool.query(updCartSQL, updCartVals);
    /* ===============================================================
   RESERVE STOCK (per-warehouse, per-country)                     */
const lineSql = `
SELECT cp."productId", cp.quantity,
       p."stockData", p."manageStock", p."allowBackorders"
FROM   "cartProducts" cp
JOIN   products p ON p.id = cp."productId"
WHERE  cp."cartId" = $1
FOR UPDATE                           -- lock rows for this tx
`;
const { rows: cartLines } = await pool.query(lineSql, [cartId]);

for (const ln of cartLines) {
if (!ln.manageStock) continue;                // unlimited item

/* try to deduct from each warehouse until the whole qty is covered */
let qtyLeft = ln.quantity;                    // what we still need
for (const whId of Object.keys(ln.stockData ?? {})) {
  const whStock = (ln.stockData[whId]?.[country] ?? 0) as number;
  if (whStock <= 0) continue;

  const take = Math.min(whStock, qtyLeft);    // units we’ll grab here
  await pool.query(
    `UPDATE products
     SET "stockData" = jsonb_set(
       "stockData",
       ARRAY[$1,$2],                    -- [warehouseId,country]
       to_jsonb((($3)::int) - $4)       -- new stock value
     )
     WHERE id = $5`,
    [whId, country, whStock, take, ln.productId]
  );

  qtyLeft -= take;
  if (qtyLeft === 0) break;                  // done for this item
}

/* if we still need units and back-orders are NOT allowed → abort */
if (qtyLeft > 0 && !ln.allowBackorders) {
  await pool.query("ROLLBACK");
  return NextResponse.json(
    { error: "out_of_stock", productId: ln.productId },
    { status: 400 },
  );
}
}
/* =============================================================== */
    const r = await pool.query(insertSQL, insertValues);
    await pool.query("COMMIT");
    return NextResponse.json(r.rows[0], { status: 201 });
  } catch (err) {
    await pool.query("ROLLBACK");
    console.error("[POST /api/order] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
