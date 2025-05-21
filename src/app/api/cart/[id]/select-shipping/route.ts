// src/app/api/cart/[id]/select-shipping/route.ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Pool } from "pg";
import { getContext } from "@/lib/context";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const selectShippingSchema = z.object({
  shippingMethod: z.string().uuid(),
});

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { organizationId } = ctx;
  const { id } = await params;

  // 1) Find cart’s country
  const cartRes = await pool.query(
    `SELECT country FROM carts WHERE id = $1`,
    [id]
  );
  if (cartRes.rowCount === 0) {
    return NextResponse.json({ error: "Cart not found" }, { status: 404 });
  }
  const cartCountry = cartRes.rows[0].country;

  // 2) List all shippingMethods for this org…
  const allSM = await pool.query(
    `SELECT id, name, price, countries
       FROM "shippingMethods"
      WHERE "organizationId" = $1`,
    [organizationId]
  );

  // 3) Filter by cartCountry
  const methods = allSM.rows
    .map((r) => ({ ...r, countries: JSON.parse(r.countries) }))
    .filter((r) => r.countries.includes(cartCountry))
    .map((r) => ({ id: r.id, name: r.name, price: r.price }));

  return NextResponse.json({ methods }, { status: 200 });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { organizationId } = ctx;

  try {
    const { id } = await params;
    const { shippingMethod } = selectShippingSchema.parse(await req.json());

    // 1) Check cart exists & get its country
    const cartRes = await pool.query(
      `SELECT country FROM carts WHERE id = $1`,
      [id]
    );
    if (cartRes.rowCount === 0) {
      return NextResponse.json({ error: "Cart not found" }, { status: 404 });
    }
    const cartCountry = cartRes.rows[0].country;

    // 2) Load the shippingMethod row
    const smRes = await pool.query(
      `SELECT countries FROM "shippingMethods" WHERE id = $1 AND "organizationId" = $2`,
      [shippingMethod, organizationId]
    );
    if (smRes.rowCount === 0) {
      return NextResponse.json({ error: "Shipping method not found" }, { status: 404 });
    }
    const allowed = JSON.parse(smRes.rows[0].countries);
    if (!allowed.includes(cartCountry)) {
      // you can leave your “country‐mismatch” block here,
      // but instead of “//Error” simply:
      return NextResponse.json(
        { error: "This shipping method is not available for your country." },
        { status: 400 }
      );
    }

    // 3) All good → update the cart
    const updateRes = await pool.query(
      `UPDATE carts
          SET "shippingMethod" = $1,
              "updatedAt"      = NOW()
        WHERE id = $2
      RETURNING *`,
      [shippingMethod, id]
    );

    return NextResponse.json(updateRes.rows[0], { status: 201 });
  } catch (err: any) {
    console.error(err);
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.errors }, { status: 400 });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
