// src/app/api/cart/[id]/apply-shipment/route.ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { pgPool as pool } from "@/lib/db";;
import { getContext } from "@/lib/context";



// accept either a string or a number, but always turn it into a string
const applyShipmentSchema = z
  .object({
    shippingMethod: z.union([z.string(), z.number()]),
  })
  .transform(({ shippingMethod }) => ({
    shippingMethod: String(shippingMethod),
  }));

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { organizationId } = ctx;

  try {
    // parse & normalize
    const { id } = await params;
    const { shippingMethod } = applyShipmentSchema.parse(await req.json());

    // 1) load cart country + subtotal
    const cartRes = await pool.query<{
      country: string;
      subtotal: number;
    }>(
      `
      SELECT
        country,
        COALESCE((
          SELECT SUM(cp."unitPrice" * cp.quantity)
          FROM "cartProducts" cp
          WHERE cp."cartId" = $1
         ), 0) AS subtotal
      FROM carts
      WHERE id = $1
      `,
      [id]
    );
    if (!cartRes.rows.length) {
      return NextResponse.json({ error: "Cart not found" }, { status: 404 });
    }
    const { country, subtotal } = cartRes.rows[0];

    // 2) load that shipment’s definition
    const shipRes = await pool.query<{
      costs: string;
      countries: string;
    }>(
      `
      SELECT costs, countries
      FROM shipments
      WHERE id = $1 AND "organizationId" = $2
      `,
      [shippingMethod, organizationId]
    );
    if (!shipRes.rows.length) {
      return NextResponse.json(
        { error: "Shipping method not found" },
        { status: 404 }
      );
    }

    const costs = JSON.parse(shipRes.rows[0].costs) as Array<{
      minOrderCost: number;
      maxOrderCost: number;
      shipmentCost: number;
    }>;
    const allowedCountries = JSON.parse(
      shipRes.rows[0].countries
    ) as string[];

    // 3) country check
    if (!allowedCountries.includes(country)) {
      return NextResponse.json(
        { error: `Shipping not available in ${country}` },
        { status: 400 }
      );
    }

    // 4) pick the right cost band
    const band = costs.find((b) => {
      const { minOrderCost: lo, maxOrderCost: hi } = b;
      return subtotal >= lo && (hi === 0 || subtotal <= hi);
    });
    if (!band) {
      return NextResponse.json(
        { error: "No shipping rate for this order amount" },
        { status: 400 }
      );
    }
    const shippingCost = band.shipmentCost;

    // 5) **DO NOT** write to carts at all.
    //    We’ll persist at order‐time instead.

    // 6) return cost (and method) so bot can stash them
    return NextResponse.json(
      { shippingCost, shippingMethod },
      { status: 200 }
    );
  } catch (err: any) {
    console.error("[PATCH /api/cart/[id]/apply-shipment]", err);
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.errors }, { status: 400 });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
