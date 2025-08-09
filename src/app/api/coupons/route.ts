import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { pgPool as pool } from "@/lib/db";
import { v4 as uuidv4 } from "uuid";
import { getContext } from "@/lib/context";

// nothing
// Updated coupon schema with new "expendingMinimum" field.
const couponSchema = z.object({
  name: z.string().min(1, { message: "Name is required." }),
  code: z.string().min(1, { message: "Code is required." }),
  description: z.string().min(1, { message: "Description is required." }),
  discountType: z.enum(["fixed", "percentage"]),
  discountAmount: z.coerce
    .number()
    .min(0.01, "Amount must be greater than 0"),
  usageLimit: z.coerce.number().int().min(0, { message: "Usage limit must be at least 0." }),
  // Make optional with default to avoid NaN when omitted by the client
  usagePerUser: z
    .coerce
    .number()
    .int()
    .min(0, { message: "Usage per user must be at least 0." })
    .optional()
    .default(0),
  expendingLimit: z.coerce.number().int().min(0, { message: "Expending limit must be at least 0." }),
  // New field:
  expendingMinimum: z.coerce.number().int().min(0, { message: "Expending minimum must be at least 0." }).default(0),
  countries: z.array(z.string()).min(1, { message: "At least one country is required." }),
  visibility: z.boolean(),
  expirationDate: z.string().nullable().optional(),
  startDate: z.string().nullable().optional(),
  limitPerUser: z.coerce
    .number()
    .int()
    .min(0, "Limit per user must be 0 or greater")
    .default(0),
});

export async function GET(req: NextRequest) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { organizationId } = ctx;

  const { searchParams } = new URL(req.url);
  const page = Number(searchParams.get("page")) || 1;
  const pageSize = Number(searchParams.get("pageSize")) || 10;
  const search = searchParams.get("search") || "";

  let countQuery = `
    SELECT COUNT(*) FROM coupons
    WHERE "organizationId" = $1
  `;
  const countValues: any[] = [organizationId];
  if (search) {
    countQuery += ` AND (name ILIKE $2 OR code ILIKE $2 OR description ILIKE $2)`;
    countValues.push(`%${search}%`);
  }

  // Updated SELECT query to include "expendingMinimum"
  let query = `
    SELECT id, "organizationId", name, code, description, "discountType", "discountAmount", "startDate", "expirationDate", 
      "limitPerUser", "usageLimit","usagePerUser", "expendingLimit", "expendingMinimum", countries, visibility, "createdAt", "updatedAt"
    FROM coupons
    WHERE "organizationId" = $1
  `;
  const values: any[] = [organizationId];
  if (search) {
    query += ` AND (name ILIKE $2 OR code ILIKE $2 OR description ILIKE $2)`;
    values.push(`%${search}%`);
  }
  query += ` ORDER BY "createdAt" DESC LIMIT $${values.length + 1} OFFSET $${values.length + 2}`;
  values.push(pageSize, (page - 1) * pageSize);

  try {
    const countResult = await pool.query(countQuery, countValues);
    const totalRows = Number(countResult.rows[0].count);
    const totalPages = Math.ceil(totalRows / pageSize);

    const result = await pool.query(query, values);
    const coupons = result.rows;
    coupons.forEach((coupon) => {
      coupon.countries = JSON.parse(coupon.countries);
    });

    return NextResponse.json({
      coupons,
      totalPages,
      currentPage: page,
    });
  } catch (error: any) {
    console.error("[GET /api/coupons] error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { organizationId } = ctx;

  try {
    const body = await req.json();
    const parsedCoupon = couponSchema.parse(body);

    const {
      name,
      code,
      description,
      discountType,
      discountAmount,
      startDate,
      expirationDate,
      limitPerUser,
      usageLimit,
      usagePerUser,
      expendingLimit,
      expendingMinimum, // new field
      countries,
      visibility,
    } = parsedCoupon;

    const couponId = uuidv4();

    const insertQuery = `
      INSERT INTO coupons(id, "organizationId", name, code, description, "discountType", "discountAmount", "startDate", "expirationDate", "limitPerUser", "usageLimit", "expendingLimit", "expendingMinimum", countries, visibility, "createdAt", "updatedAt")
      VALUES($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, NOW(), NOW())
      RETURNING *
    `;
    const values = [
      couponId,
      organizationId,
      name,
      code,
      description,
      discountType,
      discountAmount,
      startDate,
      expirationDate,
      limitPerUser,
      usageLimit,
      expendingLimit,
      expendingMinimum,  // new field value inserted here
      JSON.stringify(countries),
      visibility,
    ];

    const result = await pool.query(insertQuery, values);
    const coupon = result.rows[0];
    coupon.countries = JSON.parse(coupon.countries);
    return NextResponse.json(coupon, { status: 201 });
  } catch (error: any) {
    console.error("[POST /api/coupons] error:", error);
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.errors }, { status: 400 });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
