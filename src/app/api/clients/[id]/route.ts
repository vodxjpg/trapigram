import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { pgPool as pool } from "@/lib/db";;
import { getContext } from "@/lib/context";

// nothing
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

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { organizationId } = ctx;

  try {
    const { id } = await params;

    // ── Base client record ────────────────────────────────────────────
    const clientQuery = `
      SELECT id, "userId", "organizationId", username, "firstName", "lastName",
             "lastInteraction", email, "phoneNumber", "levelId", "referredBy",
             country, "createdAt", "updatedAt"
      FROM clients
      WHERE id = $1 AND "organizationId" = $2
    `;
    const clientResult = await pool.query(clientQuery, [id, organizationId]);
    if (clientResult.rows.length === 0) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }
    const client = clientResult.rows[0];

    // ── Orders summary ────────────────────────────────────────────────
    const lastPurchaseQuery = `
      SELECT "createdAt"
      FROM orders
      WHERE "clientId" = $1
      ORDER BY "createdAt" DESC
      LIMIT 1
    `;
    const [{ rows: lastPurchaseRows }] = await Promise.all([
      pool.query(lastPurchaseQuery, [id]),
    ]);
    const lastPurchase = lastPurchaseRows[0] ?? null;

    const totalOrdersQuery = `
      SELECT id, "cartId"
      FROM orders
      WHERE "clientId" = $1
    `;
    const totalOrdersResult = await pool.query(totalOrdersQuery, [id]);
    const totalOrders = totalOrdersResult.rows.length;

    // ── Build product purchase list ───────────────────────────────────
    type ProductAgg = { productId: string; quantity: number };
    const productList: ProductAgg[] = [];

    for (const order of totalOrdersResult.rows) {
      const cartQuery = `
        SELECT "productId", quantity
        FROM "cartProducts"
        WHERE "cartId" = $1
      `;
      const cartRows = (await pool.query(cartQuery, [order.cartId])).rows;
      for (const { productId, quantity } of cartRows) {
        productList.push({ productId, quantity });
      }
    }

    // ── Aggregate quantities per product ──────────────────────────────
    const totals = productList.reduce<Record<string, number>>((acc, { productId, quantity }) => {
      acc[productId] = (acc[productId] ?? 0) + quantity;
      return acc;
    }, {});

    const summary = Object.entries(totals).map(([productId, quantity]) => ({
      productId,
      quantity,
    }));

    // ── Most-purchased product (if any) ───────────────────────────────
    let mostPurchased: { title: string } | null = null;
    let quantityPurchased = 0;

    if (summary.length) {
      const maxItem = summary.reduce((best, cur) =>
        cur.quantity > best.quantity ? cur : best,
      );

      const mostPurchasedQuery = `
        SELECT title
        FROM products
        WHERE id = $1
        LIMIT 1
      `;
      const mpResult = await pool.query(mostPurchasedQuery, [maxItem.productId]);
      mostPurchased = mpResult.rows[0] ?? null;
      quantityPurchased = maxItem.quantity;
    }

    // ── Response ──────────────────────────────────────────────────────
    return NextResponse.json({
      client,
      lastPurchase,
      totalOrders,
      mostPurchased,
      quantityPurchased,
    });
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