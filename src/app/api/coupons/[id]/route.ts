import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { pgPool as pool } from "@/lib/db";
import { getContext } from "@/lib/context";

// nothing
// Updated coupon update schema with new field "expendingMinimum"
const couponUpdateSchema = z.object({
  name: z.string().min(1, { message: "Name is required." }),
  code: z.string().min(1, { message: "Code is required." }),
  description: z.string().min(1, { message: "Description is required." }),
  discountType: z.enum(["fixed", "percentage"]),
  discountAmount: z.coerce
    .number()
    .min(0.01, "Amount must be greater than 0"),

  usageLimit: z.coerce.number().int().min(0, { message: "Usage limit must be at least 0." }),
  expendingLimit: z.coerce.number().int().min(0, { message: "Expending limit must be at least 0." }),
  // New field:
  expendingMinimum: z.coerce.number().int().min(0, { message: "Expending minimum must be at least 0." }).default(0),
  countries: z.array(z.string()).min(1, { message: "At least one country is required." }),
  visibility: z.boolean(),
  startDate: z.string().nullable().optional(),
  expirationDate: z.string().nullable().optional(),
  limitPerUser: z.coerce
    .number()
    .int()
    .min(0, "Limit per user must be 0 or greater")
    .default(0),
});

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { organizationId } = ctx;

  try {
    const { id } = await params;
    const query = `
      SELECT id, "organizationId", name, code, description, "discountType", "discountAmount", "expirationDate", "startDate",
     "limitPerUser", "usageLimit", "expendingLimit", "expendingMinimum", countries, visibility, "createdAt", "updatedAt"
       FROM coupons
      FROM coupons
      WHERE id = $1 AND "organizationId" = $2
    `;
    const result = await pool.query(query, [id, organizationId]);
    if (result.rows.length === 0) {
      return NextResponse.json({ error: "Coupon not found" }, { status: 404 });
    }
    const coupon = result.rows[0];
    coupon.countries = JSON.parse(coupon.countries);
    return NextResponse.json(coupon);
  } catch (error: any) {
    console.error("[GET /api/coupons/[id]] error:", error);
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
    // Parse the request body with the updated schema.
    const parsedCoupon = couponUpdateSchema.parse(body);

    const updates: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    // Build dynamic update query based on provided fields.
    for (const [key, value] of Object.entries(parsedCoupon)) {
      if (value !== undefined) {
        updates.push(`"${key}" = $${paramIndex++}`);
        // For countries, we need to stringify the value.
        if (key === "countries" && value !== null) {
          values.push(JSON.stringify(value));
        } else {
          values.push(value);
        }
      }
    }

    if (updates.length === 0) {
      return NextResponse.json({ error: "No fields provided to update" }, { status: 400 });
    }

    // Add coupon id and organization id.
    values.push(id, organizationId);
    const query = `
      UPDATE coupons
      SET ${updates.join(", ")}, "updatedAt" = NOW()
      WHERE id = $${paramIndex++} AND "organizationId" = $${paramIndex}
      RETURNING *
    `;
    const result = await pool.query(query, values);
    if (result.rows.length === 0) {
      return NextResponse.json({ error: "Coupon not found" }, { status: 404 });
    }
    const coupon = result.rows[0];
    coupon.countries = JSON.parse(coupon.countries);
    return NextResponse.json(coupon);
  } catch (error: any) {
    console.error("[PATCH /api/coupons/[id]] error:", error);
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
      DELETE FROM coupons
      WHERE id = $1 AND "organizationId" = $2
      RETURNING *
    `;
    const result = await pool.query(query, [id, organizationId]);
    if (result.rows.length === 0) {
      return NextResponse.json({ error: "Coupon not found" }, { status: 404 });
    }
    return NextResponse.json({ message: "Coupon deleted successfully" });
  } catch (error: any) {
    console.error("[DELETE /api/coupons/[id]] error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
