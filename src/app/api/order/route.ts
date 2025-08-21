// src/app/api/order/route.ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import type { URLSearchParams } from "url";
import { pgPool as pool } from "@/lib/db";
import { v4 as uuidv4 } from "uuid";
import crypto from "crypto";
import { getContext } from "@/lib/context";
import { requireOrgPermission } from "@/lib/perm-server";

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
  organization: z.string(),//
  clientId: z.string().uuid(),//
  cartId: z.string().uuid(),//
  country: z.string().length(2),//
  paymentMethod: z.string().min(1),//
  shippingAmount: z.coerce.number().min(0),//
  shippingMethodTitle: z.string(),//
  shippingMethodDescription: z.string(),//
  discountAmount: z.coerce.number().min(0),//
  totalAmount: z.coerce.number().min(0),//
  subtotal: z.coerce.number().min(0),//
  couponCode: z.string().nullable().optional(),//
  couponType: z.string().nullable().optional(),//
  shippingCompany: z.string().nullable().optional(),//
  address: z.string().min(1),//
  trackingNumber: z.string().nullable().optional(),
  discountValue: z.array(z.number()),
  pointsRedeemed: z.coerce.number().min(0).optional(),
  pointsRedeemedAmount: z.coerce.number().min(0).optional(),
});
type OrderPayload = z.infer<typeof orderSchema>;

/* ================================================================== */
/* GET – single / list                                                */
/* ================================================================== */
/* --------------------------------------------------------------- */
/* Optional response field projection via ?fields=a,b,c            */
/* --------------------------------------------------------------- */
function parseFields(sp: URLSearchParams): string[] | null {
  const raw = sp.get("fields");
  if (!raw) return null;
  return raw.split(",").map(s => s.trim()).filter(Boolean);
}
function pickFields<T extends Record<string, any>>(obj: T, fields: string[] | null) {
  if (!fields) return obj;
  return fields.reduce<Record<string, any>>(
    (acc, k) => (k in obj ? ((acc[k] = (obj as any)[k]), acc) : acc),
    {},
  );
}

export async function GET(req: NextRequest) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { organizationId } = ctx;
  const { searchParams } = new URL(req.url);
  const fields = parseFields(searchParams);

  /* Accept both ?orderKey=123 and ?reference=123 -------------------- */
  const filterOrderKey = searchParams.get("orderKey") ?? searchParams.get("reference");

  const filterClientId = searchParams.get("clientId");
  const filterStatus = searchParams.get("status");
  const filterReferral = searchParams.get("referralAwarded");

  const limitParam = searchParams.get("limit");
  const limit =
    limitParam != null ? Math.max(1, Math.min(100, Number(limitParam) || 10)) : null;

  try {
    /* 1) Single order ------------------------------------------------- */
    if (filterOrderKey) {
      const sql = `
        SELECT
          o.*,
          c."firstName", c."lastName", c."username", c.email,
          c."referredBy" AS "referredBy"
        FROM orders o
        JOIN clients c ON c.id = o."clientId"
           WHERE o."organizationId" = $1
        AND (o."orderKey" = $2 OR o."orderKey" = ('S-' || $2))
       LIMIT 1
      `;
      const r = await pool.query(sql, [organizationId, filterOrderKey]);
      if (!r.rowCount)
        return NextResponse.json({ error: "Order not found" }, { status: 404 });
      const row = r.rows[0];
      return NextResponse.json(pickFields(row, fields), { status: 200 });
    }

    /* 2) Orders by client – newest first ------------------------------ */
    if (filterClientId) {
      const clauses: string[] = [
        `o."organizationId" = $1`,
        `o."clientId"       = $2`,
      ];
      const vals: unknown[] = [organizationId, filterClientId];

      if (filterStatus) {
        const statuses = filterStatus.split(",");
        if (statuses.length > 1) {
          clauses.push(
            `o.status IN (${statuses.map((_, i) => `$${vals.length + i + 1}`).join(",")})`,
          );
          vals.push(...statuses);
        } else {
          clauses.push(`o.status = $${vals.length + 1}`);
          vals.push(filterStatus);
        }
      }
      if (filterReferral === "false")
        clauses.push(`COALESCE(o."referralAwarded", FALSE) = FALSE`);
      if (filterReferral === "true") clauses.push(`o."referralAwarded" = TRUE`);

      // optional LIMIT
      let limitClause = "";
      if (limit) {
        limitClause = ` LIMIT $${vals.length + 1}`;
        vals.push(limit);
      }

      const sql = `
        SELECT
          o.*,
          c."firstName", c."lastName", c."username", c.email,
          c."referredBy" AS "referredBy"
        FROM orders o
        JOIN clients c ON c.id = o."clientId"
       WHERE ${clauses.join(" AND ")}
       ORDER BY o."dateCreated" DESC
       ${limitClause}
      `;
      const r = await pool.query(sql, vals);
      const orders = r.rows.map(o => ({
        id: o.id,
        orderKey: o.orderKey,
        status: o.status,
        createdAt: o.createdAt,
        total: Number(o.totalAmount),
        trackingNumber: o.trackingNumber,
        clientId: o.clientId,
        firstName: o.firstName,
        lastName: o.lastName,
        username: o.username,
        email: o.email,
        shippingCompany: o.shippingService ?? null,
        referralAwarded: !!o.referralAwarded,
        referredBy: o.referredBy ?? null, // from clients join
      }));
      const projected = fields ? orders.map(o => pickFields(o, fields)) : orders;
      return NextResponse.json(projected, { status: 200 });
    }

    /* 3) Full list ---------------------------------------------------- */
    const clauses: string[] = [`o."organizationId" = $1`];
    const vals: unknown[] = [organizationId];

    if (filterStatus) {
      const statuses = filterStatus.split(",");
      if (statuses.length > 1) {
        clauses.push(
          `o.status IN (${statuses.map((_, i) => `$${vals.length + i + 1}`).join(",")})`,
        );
        vals.push(...statuses);
      } else {
        clauses.push(`o.status = $${vals.length + 1}`);
        vals.push(filterStatus);
      }
    }
    if (filterReferral === "false") {
      clauses.push(`COALESCE(o."referralAwarded", FALSE) = FALSE`);
    }
    if (filterReferral === "true") {
      clauses.push(`o."referralAwarded" = TRUE`);
    }
    const listSql = `
      SELECT
        o.*,
        c."firstName", c."lastName", c."username", c.email,
        c."referredBy" AS "referredBy"
      FROM orders o
      JOIN clients c ON c.id = o."clientId"
     WHERE ${clauses.join(" AND ")}
     ORDER BY o."dateCreated" DESC
    `;
    const r = await pool.query(listSql, vals);
    const orders = r.rows.map(o => ({
      id: o.id,
      orderKey: o.orderKey,
      status: o.status,
      createdAt: o.createdAt,
      total: Number(o.totalAmount),
      trackingNumber: o.trackingNumber,
      clientId: o.clientId,
      firstName: o.firstName,
      lastName: o.lastName,
      username: o.username,
      email: o.email,
      shippingCompany: o.shippingService ?? null,
      referralAwarded: !!o.referralAwarded,
      referredBy: o.referredBy ?? null, // from clients join
    }));
    const projected = fields ? orders.map(o => pickFields(o, fields)) : orders;
    return NextResponse.json(projected, { status: 200 });
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
    console.log(body)
    body.organization = organizationId;
    body.totalAmount =
      body.subtotal -
      body.discountAmount -
      (body.pointsRedeemedAmount ?? 0) +
      body.shippingAmount;

    // Recalculate monetary subtotal from non-affiliate cart lines
    const normalRows = await pool.query(
      `SELECT cp.quantity, cp."unitPrice"
         FROM "cartProducts" cp
         JOIN products p ON p.id = cp."productId"
        WHERE cp."cartId" = $1`,
      [body.cartId],
    );
    const monetarySubtotal = normalRows.rows.reduce(
      (acc, r) => acc + Number(r.unitPrice) * r.quantity,
      0,
    );
    const discountAmt = Number(body.discountAmount ?? 0);
    const pointsAmt = Number(body.pointsRedeemedAmount ?? 0);
    const shippingAmt = Number(body.shippingAmount ?? 0);

    body.subtotal = monetarySubtotal;
    body.totalAmount = monetarySubtotal - discountAmt - pointsAmt + shippingAmt;

    payload = orderSchema.parse(body);
    console.log(payload)
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
    shippingCompany,
    address,
    trackingNumber = null,
    subtotal,
    discountValue,
    pointsRedeemed = 0,
    pointsRedeemedAmount = 0,
  } = payload;
  const couponTypeResolved = couponType ?? null;

  const orderId = uuidv4();
  await pool.query(
    `CREATE SEQUENCE IF NOT EXISTS order_key_seq START 1 INCREMENT 1 OWNED BY NONE`,
  );
  const seq = await pool.query(`SELECT nextval('order_key_seq') AS seq`);
  const orderKey = String(Number(seq.rows[0].seq)).padStart(3, "0");

  const encryptedAddress = encryptSecretNode(address);
  const shippingMethod = `${shippingMethodTitle} - ${shippingMethodDescription}`;
  const orderStatus = "open";
  const cartStatus = false;

  const baseValues: unknown[] = [
    orderId,
    organization,
    clientId,
    cartId,
    country,
    paymentMethod,
    shippingAmount,
    discountAmount,
    totalAmount,
    couponCode,
    couponTypeResolved,
    shippingCompany,
    shippingMethod,
    trackingNumber,
    encryptedAddress,
    orderStatus,
    subtotal,
    discountValue,
    pointsRedeemed,
    pointsRedeemedAmount,
  ];
  const cartHash = encryptSecretNode(JSON.stringify(baseValues));
    // Maintain NOT NULL invariant for carts.cartUpdatedHash as well
  const cartUpdatedHash = cartHash
  const insertValues = [...baseValues, cartHash, orderKey];

  const insertSQL = `
    INSERT INTO orders
      (id, "organizationId","clientId","cartId",country,"paymentMethod",
       "shippingTotal","discountTotal","totalAmount",
       "couponCode","couponType","shippingService","shippingMethod",
       "trackingNumber",address,status,subtotal,"discountValue",
       "pointsRedeemed","pointsRedeemedAmount","cartHash",
       "orderMeta","dateCreated","createdAt","updatedAt","orderKey")
    VALUES
      ($1, $2, $3, $4,$5, $6,
       $7, $8, $9,
       $10, $11, $12, $13,
       $14,$15,$16, $17, $18,
       $19,$20,$21,
       '[]'::jsonb,
       NOW(),NOW(),NOW(),$22)
    RETURNING *
  `;

  const updCartSQL = `
        UPDATE carts
       SET status = $1,
           "updatedAt" = NOW(),
           "cartHash" = $2,
           "cartUpdatedHash" = $3
     WHERE id = $4
  `;
  const updCartVals = [cartStatus, cartHash, cartUpdatedHash, cartId];

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

      if (qtyLeft > 0 && !ln.allowBackorders) {
        await pool.query("ROLLBACK");
        return NextResponse.json(
          { error: "out_of_stock", productId: ln.productId },
          { status: 400 },
        );
      }
    }

    const r = await pool.query(insertSQL, insertValues);
    await pool.query("COMMIT");

      // ────────────────────────────────────────────────────────────────
    // Split the order into supplier orders based on sharedProductMapping.
    // Changes:
    //  • Price supplier lines at the *transfer* price from sharedProduct.cost[country]
    //  • Pro-rate buyer shipping across supplier orders by transfer-subtotal share
    //  • Remove the old "second pass" loop
    // ────────────────────────────────────────────────────────────────
        const oldOrder = await pool.query(
       `SELECT * FROM "orders" WHERE id = $1`,
       [r.rows[0].id],
     );
     const oldCart = await pool.query(
       `SELECT * FROM "carts" WHERE id = $1`,
       [oldOrder.rows[0].cartId],
     );
     const oldCartProduct = await pool.query(
       `SELECT * FROM "cartProducts" WHERE "cartId" = $1`,
       [oldOrder.rows[0].cartId],
     );
    let oneProducts = oldCartProduct.rows;
    let newOrderId = "";

        // keep BOTH ids so we can read qty from the original cart (target)
    type MapItem = {
      organizationId: string;
      shareLinkId: string;
      sourceProductId: string;
      targetProductId: string;
    };
    let array: MapItem[] = [];
    let newOrganization = "";

          for (let i = 0; i < oneProducts.length; i++) {
        const two = await pool.query(
          `SELECT * FROM "sharedProductMapping" WHERE "targetProductId" = $1`,
          [oneProducts[i].productId],
        );
      if (two.rows[0]) {
                const orgTwo = await pool.query(
          `SELECT "organizationId" FROM "products" WHERE "id" = $1`,
          [two.rows[0].sourceProductId],
        );
        newOrganization = orgTwo.rows[0].organizationId;

        array.push({
          organizationId: newOrganization,
          shareLinkId: two.rows[0].shareLinkId,
          sourceProductId: two.rows[0].sourceProductId,
          targetProductId: two.rows[0].targetProductId,
        });
      }
    }
      const groupedMap = array.reduce<Record<string, MapItem[]>>((acc, item) => {
    if (!acc[item.organizationId]) acc[item.organizationId] = [];
    acc[item.organizationId].push(item);
    return acc;
  }, {});

  const groupedArray = Object.entries(groupedMap).map(([organizationId, items]) => ({
    organizationId,
    items,
  }));

  // Pre-compute each supplier group's transfer-price subtotal to pro-rate shipping later
 console.log("[split] supplier groups:", Object.keys(groupedMap).length);
 const transferSubtotals: Record<string, number> = {};
  for (const group of groupedArray) {
    let sum = 0;
    for (const it of group.items) {
         const oldCartProductInfo = await pool.query(
     `SELECT quantity FROM "cartProducts"
       WHERE "cartId" = $1 AND "productId" = $2`,
     [oldOrder.rows[0].cartId, it.targetProductId],
   );
      const qty = Number(oldCartProductInfo.rows[0]?.quantity || 0);
      // Fetch transfer price from sharedProduct
         const sp = await pool.query(
     `SELECT cost FROM "sharedProduct"
       WHERE "shareLinkId" = $1 AND "productId" = $2
       LIMIT 1`,
     [it.shareLinkId, it.sourceProductId],
     );
      if (!sp.rows[0]) continue; // no share row; skip silently
      const transfer = Number(sp.rows[0].cost?.[oldCart.rows[0].country] ?? 0);
      sum += transfer * qty;
    }
    transferSubtotals[group.organizationId] = sum;
  }
  const buyerShipping = Number(oldOrder.rows[0].shippingTotal || 0);
  const totalTransferSubtotal = Object.values(transferSubtotals).reduce((a, b) => a + b, 0) || 0;
  let shippingAssigned = 0;

  // Create supplier orders (single pass)
  for (let i = 0; i < groupedArray.length; i++) {
    const group = groupedArray[i];
        const oldClient = await pool.query(
    `SELECT * FROM "clients" WHERE "id" = $1`,
    [oldOrder.rows[0].clientId],
  );
  const checkClient = await pool.query(
    `SELECT id FROM clients WHERE "userId" = $1 AND "organizationId" = $2`,
    [oldClient.rows[0].userId, groupedArray[i].organizationId],
  );

        let newClientId = "";

        if (checkClient.rows.length > 0) {
          newClientId = checkClient.rows[0].id;
        } else {
          newClientId = uuidv4();

 await pool.query(
   `INSERT INTO "clients" (id,"userId","organizationId",username,"firstName","lastName",email,"phoneNumber",country,"createdAt","updatedAt")
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW(),NOW())`,
   [
     newClientId,
     oldClient.rows[0].userId,
     groupedArray[i].organizationId,
     oldClient.rows[0].username,
     oldClient.rows[0].firstName,
     oldClient.rows[0].lastName,
     oldClient.rows[0].email,
     oldClient.rows[0].phoneNumber,
     oldClient.rows[0].country,
   ],
 );
        }

        const newCartId = uuidv4();
        const newStatus = false;

        // cartHash is NOT NULL in "carts"; generate one for the split carts too
        const newCartHash = encryptSecretNode(
          JSON.stringify([
            newCartId,
            newClientId,
            oldCart.rows[0].country,
            oldCart.rows[0].shippingMethod,
            groupedArray[i].organizationId,
          ]),
        );

            await pool.query(
      `INSERT INTO "carts"
         (id,"clientId",country,"shippingMethod",status,"organizationId","cartHash","cartUpdatedHash","createdAt","updatedAt")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW(),NOW())`,
      [newCartId, newClientId, oldCart.rows[0].country, oldCart.rows[0].shippingMethod, newStatus, groupedArray[i].organizationId, newCartHash, newCartHash],
    );

        
            let subtotal = 0;
    for (let j = 0; j < group.items.length; j++) {
      const { sourceProductId, targetProductId, shareLinkId } = group.items[j];
      // quantity from the buyer's original cart line (target product)
          const oldCartProductInfo = await pool.query(
      `SELECT quantity,"affiliateProductId"
         FROM "cartProducts"
        WHERE "cartId" = $1 AND "productId" = $2`,
      [oldOrder.rows[0].cartId, targetProductId],
    );
      const qty = Number(oldCartProductInfo.rows[0]?.quantity || 0);
      const affId = oldCartProductInfo.rows[0]?.affiliateProductId || null;

      // transfer price from sharedProduct
           const sp = await pool.query(
       `SELECT cost FROM "sharedProduct"
         WHERE "shareLinkId" = $1 AND "productId" = $2
         LIMIT 1`,
       [shareLinkId, sourceProductId],
     );
      const transfer = Number(sp.rows[0]?.cost?.[oldCart.rows[0].country] ?? 0);

      const newCPId = uuidv4();
          await pool.query(
      `INSERT INTO "cartProducts"
         (id,"cartId","productId","quantity","unitPrice","affiliateProductId")
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [newCPId, newCartId, sourceProductId, qty, transfer, affId],
    );
      subtotal += transfer * qty;
    }

        newOrderId = uuidv4();
        const newOrderSQL = `
          INSERT INTO orders
            (id, "organizationId","clientId","cartId",country,"paymentMethod",
             "shippingTotal", "totalAmount","shippingService","shippingMethod",
             address,status,subtotal,"pointsRedeemed","pointsRedeemedAmount",
             "dateCreated","createdAt","updatedAt","orderKey", "discountTotal")
          VALUES
            ($1, $2, $3, $4,$5, $6,
             $7, $8, $9,
             $10, $11, $12, $13,
             $14,$15,
             NOW(),NOW(),NOW(),$16, $17)
          RETURNING *
        `;
         const supplierOrderKey = `S-${orderKey}`;
                // Pro-rate shipping for this supplier group. Last group gets the rounding remainder.
        let shippingShare = 0;
        if (totalTransferSubtotal > 0) {
          if (i === groupedArray.length - 1) {
            shippingShare = buyerShipping - shippingAssigned;
          } else {
            shippingShare = Number(((buyerShipping * (transferSubtotals[groupedArray[i].organizationId] || 0)) / totalTransferSubtotal).toFixed(2));
            shippingAssigned += shippingShare;
          }
        }
        const newOrderValues = [
          newOrderId,
          groupedArray[i].organizationId,
          newClientId,
          newCartId,
          oldCart.rows[0].country,
          oldOrder.rows[0].paymentMethod,
          shippingShare,
          shippingShare + subtotal,
          oldOrder.rows[0].shippingService,
          oldOrder.rows[0].shippingMethod,
          oldOrder.rows[0].address,
          oldOrder.rows[0].status,
          subtotal,
          oldOrder.rows[0].pointsRedeemed,
          oldOrder.rows[0].pointsRedeemedAmount,
          supplierOrderKey  ,
          0,
        ];

           await pool.query(newOrderSQL, newOrderValues);
   console.log("[split] created supplier order", {
     supplierOrg: groupedArray[i].organizationId,
     orderKey: supplierOrderKey,
     subtotal,
     shippingShare,
   });
    }

    return NextResponse.json(r.rows[0], { status: 201 });
  } catch (err) {
    await pool.query("ROLLBACK");
    console.error("[POST /api/order] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
