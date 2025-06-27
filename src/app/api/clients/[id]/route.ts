import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Pool } from "pg";
import { getContext } from "@/lib/context";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

const clientUpdateSchema = z.object({
  username: z.string().min(3, { message: "Username must be at least 3 characters." }).optional(),
  firstName: z.string().min(1, { message: "First name is required." }).optional(),
  lastName: z.string().min(1, { message: "Last name is required." }).optional(),
  email: z.string().email({ message: "Please enter a valid email address." }).optional(),
  phoneNumber: z.string().min(1, { message: "Phone number is required." }).optional(),
  referredBy: z.string().optional().nullable(),
  levelId: z.string().optional().nullable(),
  country: z.string().optional().nullable(), // New field: nullable country code
});

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { organizationId } = ctx;

  try {
    const { id } = await params;
    const query = `
      SELECT id, "userId", "organizationId", username, "firstName", "lastName", "lastInteraction", email, "phoneNumber", "levelId", "referredBy", country, "createdAt", "updatedAt"
      FROM clients
      WHERE id = $1 AND "organizationId" = $2
    `;
    const result = await pool.query(query, [id, organizationId]);

    const lastPurchaseQuery = `SELECT "createdAt" FROM orders WHERE "clientId" = '${id}' ORDER BY "createdAt" DESC LIMIT 1`
    const lastPurchaseResult = await pool.query(lastPurchaseQuery)
    const lastPurchase = lastPurchaseResult.rows[0]

    const totalOrdersQuery = `SELECT * FROM orders WHERE "clientId" = '${id}'`
    const totalOrdersResult = await pool.query(totalOrdersQuery)
    const totalOrders = totalOrdersResult.rows.length

    const productList: {
      productId: string,
      quantity: number
    }[] = []

    for (const od of totalOrdersResult.rows) {
      const cartQuery = `SELECT * FROM "cartProducts" WHERE "cartId" = '${od.cartId}'`
      const cartResult = await pool.query(cartQuery)
      const cart = cartResult.rows

      for (const ca of cart) {
        productList.push({
          productId: ca.productId,
          quantity: ca.quantity
        })
      }
    }

    const totals = productList.reduce((acc, { productId, quantity }) => {
      acc[productId] = (acc[productId] || 0) + quantity;
      return acc;
    }, {});

    const summary = Object.entries(totals).map(([productId, quantity]) => ({
      productId,
      quantity
    }));

    const maxItem = summary.reduce((best, current) =>
      current.quantity > best.quantity ? current : best
    );

    const mostPurchasedQuery = `SELECT title FROM "products" WHERE "id" = '${maxItem.productId}'`
    const mostPurchasedResult = await pool.query(mostPurchasedQuery)
    const mostPurchased = mostPurchasedResult.rows[0]
    const quantityPurchased = maxItem.quantity

    if (result.rows.length === 0) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }

    return NextResponse.json({ client: result.rows[0], lastPurchase, totalOrders, mostPurchased, quantityPurchased });
  } catch (error: any) {
    console.error("[GET /api/clients/[id]] error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { organizationId } = ctx;

  try {
    const { id } = await params;
    const body = await req.json();
    const parsedClient = clientUpdateSchema.parse(body);

    const updates: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    for (const [key, value] of Object.entries(parsedClient)) {
      if (value !== undefined) {
        updates.push(`"${key}" = $${paramIndex++}`);
        values.push(value);
      }
    }

    if (updates.length === 0) {
      return NextResponse.json({ error: "No fields provided to update" }, { status: 400 });
    }

    values.push(id, organizationId);
    const query = `
      UPDATE clients
      SET ${updates.join(", ")}, "updatedAt" = NOW()
      WHERE id = $${paramIndex++} AND "organizationId" = $${paramIndex}
      RETURNING *
    `;

    const result = await pool.query(query, values);

    if (result.rows.length === 0) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }

    return NextResponse.json(result.rows[0]);
  } catch (error: any) {
    console.error("[PATCH /api/clients/[id]] error:", error);
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.errors }, { status: 400 });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { organizationId } = ctx;

  try {
    const { id } = await params;
    const query = `
      DELETE FROM clients
      WHERE id = $1 AND "organizationId" = $2
      RETURNING *
    `;
    const result = await pool.query(query, [id, organizationId]);

    if (result.rows.length === 0) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }

    return NextResponse.json({ message: "Client deleted successfully" });
  } catch (error: any) {
    console.error("[DELETE /api/clients/[id]] error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}