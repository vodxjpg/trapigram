// src/app/api/coupons/[id]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { pgPool as pool } from "@/lib/db";
import { getContext } from "@/lib/context";

/** All fields optional so PATCH can be partial */
const couponUpdateSchema = z.object({
  name: z.string().min(1, { message: "Name is required." }).optional(),
  code: z.string().min(1, { message: "Code is required." }).optional(),
  description: z.string().min(1, { message: "Description is required." }).optional(),
  discountType: z.enum(["fixed", "percentage"]).optional(),
  discountAmount: z.coerce.number().min(0.01, "Amount must be greater than 0").optional(),

  usageLimit: z.coerce.number().int().min(0, { message: "Usage limit must be at least 0." }).optional(),
  expendingLimit: z.coerce.number().int().min(0, { message: "Expending limit must be at least 0." }).optional(),
  /** NEW: expendingMinimum */
  expendingMinimum: z.coerce.number().int().min(0, { message: "Expending minimum must be at least 0." }).optional(),

  countries: z.array(z.string()).min(1, { message: "At least one country is required." }).optional(),
  visibility: z.boolean().optional(),
  stackable: z.boolean().optional(),
  startDate: z.string().nullable().optional(),
  expirationDate: z.string().nullable().optional(),
  limitPerUser: z.coerce.number().int().min(0, "Limit per user must be 0 or greater").optional(),
});

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;

  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { organizationId } = ctx;

  try {
    const query = `
      SELECT
        id, "organizationId", name, code, description,
        "discountType", "discountAmount",
        "expirationDate", "startDate",
        "limitPerUser", "usageLimit", "expendingLimit", "expendingMinimum",
        countries, visibility, stackable, "createdAt", "updatedAt"
      FROM coupons
      WHERE id = $1 AND "organizationId" = $2
    `;
    const result = await pool.query(query, [id, organizationId]);
    if (result.rows.length === 0) {
      return NextResponse.json({ error: "Coupon not found" }, { status: 404 });
    }
    const coupon = result.rows[0];
    if (typeof coupon.countries === "string") {
      try { coupon.countries = JSON.parse(coupon.countries); } catch { coupon.countries = []; }
    }
    return NextResponse.json(coupon);
  } catch (error: any) {
    console.error("[GET /api/coupons/[id]] error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;

  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { organizationId } = ctx;

  try {
    const body = await req.json();
    const parsedCoupon = couponUpdateSchema.parse(body);

    const updates: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    for (const [key, value] of Object.entries(parsedCoupon)) {
      if (value !== undefined) {
        updates.push(`"${key}" = $${paramIndex++}`);
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
    if (typeof coupon.countries === "string") {
      try { coupon.countries = JSON.parse(coupon.countries); } catch { coupon.countries = []; }
    }
    return NextResponse.json(coupon);
  } catch (error: any) {
    console.error("[PATCH /api/coupons/[id]] error:", error);
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.errors }, { status: 400 });
    }
    // Unique violation handling (e.g., code)
    if (error?.code === "23505") {
      const m = /Key \((.+)\)=\((.+)\)/.exec(error?.detail || "");
      const field = m?.[1] || "code";
      const val = m?.[2] || "";
      const msg =
        field === "code" && val
          ? `Coupon code "${val}" is already in use. Please choose a different code.`
          : `This ${field} is already in use.`;
      return NextResponse.json({ error: msg }, { status: 409 });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;

  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { organizationId } = ctx;

  try {
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
