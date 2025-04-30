import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Pool } from "pg";
import { auth } from "@/lib/auth";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});
const INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET as string;

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  // Authenticate request as before.
  const apiKey = req.headers.get("x-api-key");
  const internalSecret = req.headers.get("x-internal-secret");
  let organizationId: string;

  const { searchParams } = new URL(req.url);
  const explicitOrgId = searchParams.get("organizationId");

  // Case 1: Check for session (UI requests)
  const session = await auth.api.getSession({ headers: req.headers });
  if (session) {
    organizationId = explicitOrgId || session.session.activeOrganizationId;
    if (!organizationId) {
      return NextResponse.json({ error: "No active organization in session" }, { status: 400 });
    }
  }
  // Case 2: External API request with API key
  else if (apiKey) {
    const { valid, error, key } = await auth.api.verifyApiKey({ body: { key: apiKey } });
    if (!valid || !key) {
      return NextResponse.json({ error: error?.message || "Invalid API key" }, { status: 401 });
    }
    organizationId = explicitOrgId || "";
    if (!organizationId) {
      return NextResponse.json({ error: "Organization ID is required in query parameters" }, { status: 400 });
    }
  }
  // Case 3: Internal request with secret
  else if (internalSecret === INTERNAL_API_SECRET) {
    const internalSession = await auth.api.getSession({ headers: req.headers });
    if (!internalSession) {
      return NextResponse.json({ error: "Unauthorized session" }, { status: 401 });
    }
    organizationId = explicitOrgId || internalSession.session.activeOrganizationId;
    if (!organizationId) {
      return NextResponse.json({ error: "No active organization in session" }, { status: 400 });
    }
  } else {
    return NextResponse.json(
      { error: "Unauthorized: Provide a valid session, API key, or internal secret" },
      { status: 403 }
    );
  }

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

    if (cart.country !== clientCountry.country){
        //update prices, coupons and shipping
        //update country in cart
    }

    return NextResponse.json(cart);
  } catch (error: any) {
    console.error("[GET /api/coupons/[id]] error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}