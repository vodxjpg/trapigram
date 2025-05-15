import { NextRequest, NextResponse } from "next/server";
import { Pool } from "pg";
import { getContext } from "@/lib/context";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;

  try {
    const { id } = await params;
    const query = `
      SELECT id, "clientId", country, "counponCode", "shippingMethod", "cartHash", "cartUpdatedHash", "createdAt", "updatedAt"
      FROM carts
      WHERE id = $1
    `;
    const result = await pool.query(query, [id]);
    if (result.rows.length === 0) {
      return NextResponse.json({ error: "Coupon not found" }, { status: 404 });
    }

    const cart = result.rows[0];

    const countryQuery = `
      SELECT country
      FROM clients
      WHERE id = '${cart.clientId}'
    `;

    const countryResult = await pool.query(countryQuery);
    const clientCountry = countryResult.rows[0]

    if (cart.country !== clientCountry.country) {
      //update prices, coupons and shipping
      //update country in cart
    }

    return NextResponse.json(cart);
  } catch (error: any) {
    console.error("[GET /api/coupons/[id]] error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}