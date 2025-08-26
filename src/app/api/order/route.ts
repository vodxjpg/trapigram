// src/app/api/order/route.ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import type { URLSearchParams } from "url";
import { pgPool as pool } from "@/lib/db";
import { v4 as uuidv4 } from "uuid";
import crypto from "crypto";
import { getContext } from "@/lib/context";
import { requireOrgPermission } from "@/lib/perm-server";
import { adjustStock } from "@/lib/stock";
import { sendNotification } from "@/lib/notifications";


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

   
    // order deduct block

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


    const oneProducts = oldCartProduct.rows; // C’s cart lines
    let newOrderId = "";

    // We’ll create supplier orders org-by-org for *every hop* up the chain.
    type MapItem = {
      organizationId: string;      // supplier org for this hop
      shareLinkId: string;         // share link used *at this hop*
      sourceProductId: string;     // supplier’s product at this hop
      targetProductId: string;     // leaf product in C’s cart (used to read qty)
    };

    // hop(0): C’s product → B’s product
    async function firstHop(): Promise<MapItem[]> {
      const result: MapItem[] = [];
      for (const ln of oneProducts) {
        const m = await pool.query(
          `SELECT "shareLinkId","sourceProductId","targetProductId"
         FROM "sharedProductMapping"
        WHERE "targetProductId" = $1
        LIMIT 1`,
          [ln.productId],
        );
        if (!m.rows[0]) continue;
        const orgRow = await pool.query(
          `SELECT "organizationId" FROM "products" WHERE id = $1`,
          [m.rows[0].sourceProductId],
        );
        if (!orgRow.rows[0]) continue;
        result.push({
          organizationId: orgRow.rows[0].organizationId,
          shareLinkId: m.rows[0].shareLinkId,
          sourceProductId: m.rows[0].sourceProductId,
          targetProductId: ln.productId,
        });
      }
      return result;
    }

    // hop(n+1): previous hop’s sourceProductId → upstream supplier’s product
    async function nextHopFrom(items: MapItem[]): Promise<MapItem[]> {
      const out: MapItem[] = [];
      for (const it of items) {
        const m = await pool.query(
          `SELECT "shareLinkId","sourceProductId","targetProductId"
         FROM "sharedProductMapping"
        WHERE "targetProductId" = $1
        LIMIT 1`,
          [it.sourceProductId], // climb one hop up
        );
        if (!m.rows[0]) continue;
        const orgRow = await pool.query(
          `SELECT "organizationId" FROM "products" WHERE id = $1`,
          [m.rows[0].sourceProductId],
        );
        if (!orgRow.rows[0]) continue;
        out.push({
          organizationId: orgRow.rows[0].organizationId,
          shareLinkId: m.rows[0].shareLinkId,
          sourceProductId: m.rows[0].sourceProductId,
          targetProductId: it.targetProductId, // keep C’s leaf for qty lookup
        });
      }
      return out;
    }

    const createdSupplierOrgs = new Set<string>(); // avoid duplicate S-orders per org

    async function createSupplierOrdersFor(items: MapItem[], includeShipping: boolean) {
      if (!items.length) return;

      // group by supplier org
      const groupedMap = items.reduce<Record<string, MapItem[]>>((acc, item) => {
        (acc[item.organizationId] ??= []).push(item);
        return acc;
      }, {});
      const groupedArray = Object.entries(groupedMap).map(([organizationId, items]) => ({
        organizationId, items,
      })).filter(g => !createdSupplierOrgs.has(g.organizationId)); // only once per org

      // Pre-compute per-group transfer subtotal for shipping split
      const transferSubtotals: Record<string, number> = {};
      for (const group of groupedArray) {
        let sum = 0;
        for (const it of group.items) {
          const { rows: qtyRow } = await pool.query(
            `SELECT quantity FROM "cartProducts"
         WHERE "cartId" = $1 AND "productId" = $2 LIMIT 1`,
            [oldOrder.rows[0].cartId, it.targetProductId],
          );
          const qty = Number(qtyRow[0]?.quantity || 0);
          const { rows: sp } = await pool.query(
            `SELECT cost FROM "sharedProduct"
           WHERE "shareLinkId" = $1 AND "productId" = $2
           LIMIT 1`,
            [it.shareLinkId, it.sourceProductId],
          );
          const transfer = Number(sp[0]?.cost?.[oldCart.rows[0].country] ?? 0);
          sum += transfer * qty;
        }
        transferSubtotals[group.organizationId] = sum;
      }

      // Only the first hop (sellers who ship to the buyer) should receive buyer shipping.
      const buyerShipping = includeShipping ? Number(oldOrder.rows[0].shippingTotal || 0) : 0;
      const totalTransferSubtotal = includeShipping
        ? (Object.values(transferSubtotals).reduce((a, b) => a + b, 0) || 0)
        : 0;
      let shippingAssigned = 0;

      for (let i = 0; i < groupedArray.length; i++) {
        const group = groupedArray[i];
        createdSupplierOrgs.add(group.organizationId);

        // ensure client in supplier org
        const oldClient = await pool.query(
          `SELECT * FROM "clients" WHERE "id" = $1`,
          [oldOrder.rows[0].clientId],
        );
        const checkClient = await pool.query(
          `SELECT id FROM clients WHERE "userId" = $1 AND "organizationId" = $2`,
          [oldClient.rows[0].userId, group.organizationId],
        );
        const newClientId = checkClient.rows[0]?.id ?? uuidv4();
        if (!checkClient.rows[0]) {
          await pool.query(
            `INSERT INTO "clients"
           (id,"userId","organizationId",username,"firstName","lastName",email,"phoneNumber",country,"createdAt","updatedAt")
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW(),NOW())`,
            [
              newClientId,
              oldClient.rows[0].userId,
              group.organizationId,
              oldClient.rows[0].username,
              oldClient.rows[0].firstName,
              oldClient.rows[0].lastName,
              oldClient.rows[0].email,
              oldClient.rows[0].phoneNumber,
              oldClient.rows[0].country,
            ],
          );
        }

        // supplier cart
        const newCartId = uuidv4();
        const newCartHash = encryptSecretNode(
          JSON.stringify([newCartId, newClientId, oldCart.rows[0].country, oldCart.rows[0].shippingMethod, group.organizationId]),
        );
        await pool.query(
          `INSERT INTO "carts"
         (id,"clientId",country,"shippingMethod",status,"organizationId","cartHash","cartUpdatedHash","createdAt","updatedAt")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$7,NOW(),NOW())`,
          [newCartId, newClientId, oldCart.rows[0].country, oldCart.rows[0].shippingMethod, false, group.organizationId, newCartHash],
        );

        // add lines at transfer price (qty from buyer’s cart for original leaf product)
        let subtotal = 0;
        for (const it of group.items) {
          const { rows: qtyRow } = await pool.query(
            `SELECT quantity,"affiliateProductId"
           FROM "cartProducts"
          WHERE "cartId" = $1 AND "productId" = $2 LIMIT 1`,
            [oldOrder.rows[0].cartId, it.targetProductId],
          );
          const qty = Number(qtyRow[0]?.quantity || 0);
          const affId = qtyRow[0]?.affiliateProductId || null;

          const { rows: sp } = await pool.query(
            `SELECT cost FROM "sharedProduct"
           WHERE "shareLinkId" = $1 AND "productId" = $2
           LIMIT 1`,
            [it.shareLinkId, it.sourceProductId],
          );
          const transfer = Number(sp[0]?.cost?.[oldCart.rows[0].country] ?? 0);

          if (qty > 0) {
            await pool.query(
              `INSERT INTO "cartProducts"
             (id,"cartId","productId","quantity","unitPrice","affiliateProductId")
           VALUES ($1,$2,$3,$4,$5,$6)`,
              [uuidv4(), newCartId, it.sourceProductId, qty, transfer, affId],
            );
            subtotal += transfer * qty;
            // reserve supplier stock now (order is ACTIVE)
            try {
              await adjustStock(pool as any, it.sourceProductId, oldCart.rows[0].country, -qty);
            } catch (e) {
              console.warn("[split][stock] reserve failed", { productId: it.sourceProductId, qty, country: oldCart.rows[0].country }, e);
            }
          }
        }

        // shipping share for this group
        const supplierOrderKey = `S-${orderKey}`;
        let shippingShare = 0;
        if (includeShipping && totalTransferSubtotal > 0) {
          if (i === groupedArray.length - 1) {
            shippingShare = buyerShipping - shippingAssigned;
          } else {
            shippingShare = Number(((buyerShipping * (transferSubtotals[group.organizationId] || 0)) / totalTransferSubtotal).toFixed(2));
            shippingAssigned += shippingShare;
          }
        }

        const newOrderIdLocal = uuidv4();
        await pool.query(
          `INSERT INTO orders
         (id, "organizationId","clientId","cartId",country,"paymentMethod",
          "shippingTotal","totalAmount","shippingService","shippingMethod",
          address,status,subtotal,"pointsRedeemed","pointsRedeemedAmount",
          "dateCreated","createdAt","updatedAt","orderKey","discountTotal","cartHash","orderMeta")
       VALUES
         ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,NOW(),NOW(),NOW(),$16,$17,$18,'[]'::jsonb)`,
          [
            newOrderIdLocal,
            group.organizationId,
            newClientId,
            newCartId,
            oldCart.rows[0].country,
            'dropshipping',
            shippingShare,
            shippingShare + subtotal,
            oldOrder.rows[0].shippingService,
            oldOrder.rows[0].shippingMethod,
            oldOrder.rows[0].address,
            oldOrder.rows[0].status,
            subtotal,
            oldOrder.rows[0].pointsRedeemed,
            oldOrder.rows[0].pointsRedeemedAmount,
            supplierOrderKey,
            0,
            newCartHash,
          ],
        );
        // created a supplier order for this org

        // notify supplier org
        const { rows: prodRows } = await pool.query(
          `
        SELECT cp.quantity,
               COALESCE(p.title, ap.title)             AS title,
               COALESCE(cat.name, 'Uncategorised')      AS category
          FROM "cartProducts" cp
          LEFT JOIN products p              ON p.id  = cp."productId"
          LEFT JOIN "affiliateProducts" ap  ON ap.id = cp."affiliateProductId"
          LEFT JOIN "productCategory" pc    ON pc."productId" = COALESCE(p.id, ap.id)
          LEFT JOIN "productCategories" cat ON cat.id = pc."categoryId"
         WHERE cp."cartId" = $1
         ORDER BY category, title
      `,
          [newCartId],
        );
        const grouped: Record<string, { q: number; t: string }[]> = {};
        for (const r of prodRows) {
          (grouped[r.category] ??= []).push({ q: r.quantity, t: r.title });
        }
        const productList = Object.entries(grouped)
          .map(([cat, items]) => {
            const lines = items.map((it) => `${it.t} - x${it.q}`).join("<br>");
            return `<b>${cat.toUpperCase()}</b><br><br>${lines}`;
          })
          .join("<br><br>");
        await sendNotification({
          organizationId: group.organizationId,
          type: "order_placed",
          subject: `Shared order created (S-${orderKey})`,
          message: `A shared order was created for your organisation.<br>{product_list}`,
          variables: { product_list: productList, order_number: `S-${orderKey}` },
          country: oldCart.rows[0].country,
          trigger: "admin_only",
          channels: ["in_app", "telegram"],
          clientId: null,
          url: `/orders/${newOrderIdLocal}`,
        });
      }
    }

    // BFS over the chain: B (first hop), then A, then further upstream…
    let frontier = await firstHop();
    let depth = 0;
    while (frontier.length && depth < 5) { // supports up to 5 hops
      await createSupplierOrdersFor(frontier, depth === 0 /* only first hop gets shipping */);
      frontier = await nextHopFrom(frontier);
      depth++;
    }


    return NextResponse.json(r.rows[0], { status: 201 });
  } catch (err) {
    await pool.query("ROLLBACK");
    console.error("[POST /api/order] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
