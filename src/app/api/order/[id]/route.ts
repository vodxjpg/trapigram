// pages/api/orders/route.ts
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

        const { id } = await params
        const getOrder = `
            SELECT * FROM orders
            WHERE "id" = '${id}'
            `;

        const resultOrder = await pool.query(getOrder);
        const order = resultOrder.rows[0];

        const getClient = `
            SELECT * FROM clients
            WHERE "id" = '${order.clientId}'
            `;

        const resultClient = await pool.query(getClient);
        const client = resultClient.rows[0];

        const getProducts = `
        SELECT 
          p.id, p.title, p.description, p.image, p.sku,
          cp.quantity, cp."unitPrice"
        FROM products p
        JOIN "cartProducts" cp ON p.id = cp."productId"
        WHERE cp."cartId" = $1
      `;
        const resultProducts = await pool.query(getProducts, [order.cartId]);
        const products = resultProducts.rows

        let total = 0

        products.map((p) => {
            p.unitPrice = Number(p.unitPrice)
            total = (p.unitPrice * p.quantity) + total

        })

        const fullOrder = {
            id: order.id,
            cartId: order.cartId,
            clientFirstName: client.firstName,
            clientLastName: client.lastName,
            clientEmail: client.email,
            clientUsername: client.username,
            status: order.status,
            products: products,
            coupon: order.couponCode,
            discount: Number(order.discountTotal),
            shipping: Number(order.shippingTotal),
            subTotal: Number(total),
            total: Number(order.totalAmount),
            shippingInfo:{
                address: order.address,
                company: order.shippingService,
                method: "Standard Shipping (3-5 business days)",
                payment: order.paymentMethod
            }
        }

        return NextResponse.json(fullOrder, { status: 201 });
    } catch (error) {
        return NextResponse.json(error, { status: 403 });
    }
}