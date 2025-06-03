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
  pointsRedeemed: z.coerce.number().min(0).optional(),
  pointsRedeemedAmount: z.coerce.number().min(0).optional(),
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
      if (!r.rowCount)
        return NextResponse.json({ error: "Order not found" }, { status: 404 });
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

  let payload: OrderPayload;
  try {
    const body = await req.json();
    body.organization = organizationId;
    body.totalAmount = body.subtotal - body.discountAmount - (body.pointsRedeemedAmount ?? 0) + body.shippingAmount;
    const normalRows = await pool.query(
      `SELECT cp.quantity, cp."unitPrice"
         FROM "cartProducts" cp
         JOIN products p ON p.id = cp."productId"
        WHERE cp."cartId" = $1`,
      [body.cartId]
    );
    const monetarySubtotal = normalRows.rows
      .reduce((acc, r) => acc + Number(r.unitPrice) * r.quantity, 0);
    const discountAmt = Number(body.discountAmount ?? 0);
    const pointsAmt = Number(body.pointsRedeemedAmount ?? 0);
    const shippingAmt = Number(body.shippingAmount ?? 0);
    body.subtotal = monetarySubtotal;
    body.totalAmount = monetarySubtotal
      - discountAmt
      - pointsAmt
      + shippingAmt;
    console.log(
      "🧮  Calculated totalAmount:",
      body.subtotal,
      "-", body.discountAmount,
      "-", (body.pointsRedeemedAmount ?? 0),
      "+", body.shippingAmount,
      "=", body.totalAmount
    )
    payload = orderSchema.parse(body);
  } catch (err) {
    if (err instanceof z.ZodError)
      return NextResponse.json({ error: err.errors }, { status: 400 });
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
    couponType,
    counponType,
    shippingCompany,
    address,
    trackingNumber = null,
    subtotal,
    discountValue,
    pointsRedeemed = 0,
    pointsRedeemedAmount = 0,
  } = payload;
  const couponTypeResolved = couponType ?? counponType ?? null;

  const orderId = uuidv4();
  await pool.query(
    `CREATE SEQUENCE IF NOT EXISTS order_key_seq START 1 INCREMENT 1 OWNED BY NONE`
  );
  const seq = await pool.query(`SELECT nextval('order_key_seq') AS seq`);
  const orderKey = String(Number(seq.rows[0].seq)).padStart(3, "0");

  const encryptedAddress = encryptSecretNode(address);
  const shippingMethod = `${shippingMethodTitle} - ${shippingMethodDescription}`;
  const orderStatus = "open";
  const cartStatus = false;

  const baseValues: unknown[] = [
    orderId, organization, clientId, cartId, country, paymentMethod,
    shippingAmount, discountAmount, totalAmount,
    couponCode, couponTypeResolved, shippingCompany, shippingMethod,
    trackingNumber, encryptedAddress, orderStatus,
    subtotal, discountValue,
    pointsRedeemed,
    pointsRedeemedAmount,
  ];
  const cartHash = encryptSecretNode(JSON.stringify(baseValues));
  const insertValues = [...baseValues, cartHash, orderKey];

  const insertSQL = `
    INSERT INTO orders
      (id, "organizationId","clientId","cartId",country,"paymentMethod",
       "shippingTotal","discountTotal","totalAmount",
       "couponCode","couponType","shippingService","shippingMethod",
       "trackingNumber",address,status,subtotal,"discountValue",
       "pointsRedeemed","pointsRedeemedAmount","cartHash",
       "dateCreated","createdAt","updatedAt","orderKey")
    VALUES
      ($1, $2, $3, $4,$5, $6,
       $7, $8, $9,
       $10, $11, $12, $13,
       $14,$15,$16, $17, $18,
       $19,$20,$21,
       NOW(),NOW(),NOW(),$22)
    RETURNING *
  `;

  const updCartSQL = `
    UPDATE carts SET status = $1, "updatedAt" = NOW(), "cartHash" = $2 WHERE id = $3
  `;
  const updCartVals = [cartStatus, cartHash, cartId];

  try {
    await pool.query("BEGIN");
    await pool.query(updCartSQL, updCartVals);

    /* ── RESERVE STOCK (unchanged) ───────────────────────────── */
    const lineSql = `
      SELECT cp."productId", cp.quantity, p."manageStock", p."allowBackorders"
      FROM   "cartProducts" cp
      JOIN   products p ON p.id = cp."productId"
      WHERE  cp."cartId" = $1
    `;
    const { rows: cartLines } = await pool.query(lineSql, [cartId]);

    for (const ln of cartLines) {
      if (!ln.manageStock) continue;
      let qtyLeft = ln.quantity;
      /* fetch every stock row that can serve this country            */
      const { rows: whRows } = await pool.query(
        `SELECT id, quantity
           FROM "warehouseStock"
          WHERE "productId" = $1
            AND country      = $2
            AND quantity     > 0
          ORDER BY quantity DESC
          FOR UPDATE`,
        [ln.productId, country],
      );

      for (const wh of whRows) {
        const take = Math.min(wh.quantity, qtyLeft);
        await pool.query(
          `UPDATE "warehouseStock"
              SET quantity  = quantity - $1,
                  "updatedAt" = NOW()
            WHERE id = $2`,
          [take, wh.id],
        );
        qtyLeft -= take;
        if (qtyLeft === 0) break;
      }

      /* not enough units and back-orders are disabled → abort */
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

<<<<<<< HEAD
    const sharedprds = await pool.query(`SELECT * FROM "cartProducts" WHERE "cartId" = '${cartId}'`)
    const isShared = sharedprds.rows.map(async (prd) => {
      console.log(prd)
      const shared = await pool.query(`SELECT * FROM "sharedProduct" WHERE "productId" = '${prd.productId}'`)
      return shared
    })
    const holis = await Promise.all(isShared)
    console.log(holis.rows)
=======
   
>>>>>>> d670d89ef3f868c4fcddbb77ec18995b962b86a5

    return NextResponse.json(r.rows[0], { status: 201 });
  } catch (err) {
    await pool.query("ROLLBACK");
    console.error("[POST /api/order] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
