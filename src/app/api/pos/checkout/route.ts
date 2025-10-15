// src/app/api/pos/checkout/route.ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { pgPool as pool } from "@/lib/db";
import { getContext } from "@/lib/context";
import { v4 as uuidv4 } from "uuid";

/** Idempotency helper */
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

const PaymentSchema = z.object({
  methodId: z.string().min(1),
  amount: z.number().nonnegative(),
});
const BodySchema = z.object({
  cartId: z.string().min(1),
  taxInclusive: z.boolean().default(true),
  payments: z.array(PaymentSchema).min(1),
  emailOverride: z.string().email().optional().nullable(),
  registerId: z.string().optional(),
  note: z.string().optional(),
});

export async function POST(req: NextRequest) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;

  return withIdempotency(req, async () => {
    try {
      const { organizationId } = ctx;
      const input = BodySchema.parse(await req.json());
      const { cartId, taxInclusive } = input;

      // Load cart, client, lines
      const { rows: cartRows } = await pool.query(`SELECT * FROM carts WHERE id=$1`, [cartId]);
      if (!cartRows.length) return { status: 404, body: { error: "Cart not found" } };
      const cart = cartRows[0];

      const { rows: clientRows } = await pool.query(
        `SELECT id,name,email,country,"levelId","isWalkIn" FROM clients WHERE id=$1`,
        [cart.clientId]
      );
      if (!clientRows.length) return { status: 404, body: { error: "Client not found" } };
      const client = clientRows[0];

      const { rows: lines } = await pool.query(
        `SELECT cp."productId",cp."variationId",cp.quantity,cp."unitPrice",
                p.title,p.sku
           FROM "cartProducts" cp
           JOIN products p ON p.id = cp."productId"
          WHERE cp."cartId"=$1
          ORDER BY cp."createdAt"`,
        [cartId]
      );
      if (!lines.length) return { status: 400, body: { error: "Cart is empty" } };

      // Tax rules per product (can be many -> sum rates)
      const { rows: taxRows } = await pool.query(
        `SELECT ptr."productId", tr.rate
           FROM "productTaxRules" ptr
           JOIN "taxRules" tr ON tr.id = ptr."taxRuleId"
          WHERE ptr."organizationId"=$1
            AND tr."organizationId"=$1
            AND tr.active=true
            AND ptr."productId" = ANY($2::text[])`,
        [organizationId, lines.map((l) => l.productId)]
      );
      const RATE_BY_PRODUCT: Record<string, number> = {};
      for (const r of taxRows) {
        const current = RATE_BY_PRODUCT[r.productId] ?? 0;
        RATE_BY_PRODUCT[r.productId] = current + Number(r.rate ?? 0); // rate stored as fraction (0..1)
      }

      // Totals
      let subtotalNet = 0;
      let taxTotal = 0;
      const receiptLines = lines.map((l) => {
        const qty = Number(l.quantity);
        const unit = Number(l.unitPrice);
        const rate = Number(RATE_BY_PRODUCT[l.productId] ?? 0);

        let netUnit = unit;
        let taxUnit = 0;
        if (taxInclusive && rate > 0) {
          taxUnit = unit * (rate / (1 + rate));
          netUnit = unit - taxUnit;
        } else if (!taxInclusive && rate > 0) {
          taxUnit = unit * rate;
        }
        const lineNet = netUnit * qty;
        const lineTax = (taxInclusive ? taxUnit : taxUnit) * qty;

        subtotalNet += lineNet;
        taxTotal += lineTax;

        return {
          productId: l.productId,
          variationId: l.variationId,
          title: l.title,
          sku: l.sku,
          quantity: qty,
          unitPrice: unit,
          netUnit,
          taxUnit,
          taxRate: rate,
          lineNet,
          lineTax,
          lineTotal: taxInclusive ? unit * qty : (netUnit + taxUnit) * qty,
        };
      });
      const grandTotal = subtotalNet + taxTotal;

      const paid = input.payments.reduce((s, p) => s + Number(p.amount), 0);
      const delta = Math.abs(paid - grandTotal);
      if (delta > 0.005) {
        return {
          status: 400,
          body: { error: "Payment splits do not match total", paid, grandTotal },
        };
      }

      // Close cart and (optionally) create order; tolerate missing tables
      const c = await pool.connect();
      try {
        await c.query("BEGIN");

        // Close the cart (status=false)
        await c.query(`UPDATE carts SET status=false, "updatedAt"=NOW() WHERE id=$1`, [cartId]);

        // Try to create an order if the table exists
        try {
          const orderId = uuidv4();
          await c.query(
            `INSERT INTO orders
              (id,"organizationId","clientId","cartId","subtotal","tax","total",
               "taxInclusive","payments","note","createdAt","updatedAt")
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW(),NOW())`,
            [
              orderId,
              organizationId,
              client.id,
              cartId,
              subtotalNet,
              taxTotal,
              grandTotal,
              taxInclusive,
              JSON.stringify(input.payments),
              input.note ?? null,
            ]
          );

          // Optionally save registerId to orders if column exists
          if (input.registerId) {
            try {
              await c.query(`UPDATE orders SET "registerId"=$2 WHERE id=$1`, [orderId, input.registerId]);
            } catch (_) {
              /* ignore if col missing */
            }
          }
        } catch (e: any) {
          if (e?.code !== "42P01") throw e; // relation missing => skip creating order
        }

        await c.query("COMMIT");
      } catch (e) {
        await c.query("ROLLBACK");
        throw e;
      } finally {
        c.release();
      }

      // Prepare receipt payload (no branding yet)
      const receipt = {
        organizationId,
        cartId,
        client: {
          id: client.id,
          name: client.name,
          email: client.isWalkIn ? null : input.emailOverride ?? client.email ?? null, // suppress for walk-in
        },
        taxInclusive,
        lines: receiptLines,
        totals: {
          subtotalNet,
          taxTotal,
          grandTotal,
          paid,
          change: Math.max(0, paid - grandTotal),
        },
        payments: input.payments,
        meta: {
          registerId: input.registerId ?? null,
          note: input.note ?? null,
        },
        createdAt: new Date().toISOString(),
      };

      return { status: 201, body: { ok: true, receipt } };
    } catch (err: any) {
      if (err instanceof z.ZodError) return { status: 400, body: { error: err.errors } };
      console.error("[POS POST /pos/checkout]", err);
      return { status: 500, body: { error: err.message ?? "Internal server error" } };
    }
  });
}
