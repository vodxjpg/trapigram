// File: src/app/api/shipping-companies/[id]/route.ts

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Pool } from "pg";
import { getContext } from "@/lib/context";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// Schema for PATCH body
const shippingMethodUpdateSchema = z.object({
  name: z.string().min(1, { message: "Name is required." }).optional(),
  countries: z.array(z.string()).optional(),
});

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {

  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { organizationId } = ctx;

  try {
    const { id } = await params;
    const { rows } = await pool.query(
      `
      SELECT id, "organizationId", name, countries, "createdAt", "updatedAt"
      FROM "shippingMethods"
      WHERE id = $1 AND "organizationId" = $2
    `,
      [id, organizationId]
    );

    if (rows.length === 0) {
      return NextResponse.json({ error: "Shipping method not found" }, { status: 404 });
    }

    const sm = rows[0];
    sm.countries = JSON.parse(sm.countries);
    return NextResponse.json(sm);
  } catch (err: any) {
    console.error("[GET /api/shipping-companies/[id]]", err);
    const status = err.message.includes("Unauthorized") ? 403 : 500;
    return NextResponse.json({ error: err.message }, { status });
  }
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
    const body = await req.json();
    body.countries = JSON.parse(body.countries)
    const parsed = shippingMethodUpdateSchema.parse(body);

    const updates: string[] = [];
    const values: any[] = [];
    let idx = 1;

    for (const [key, val] of Object.entries(parsed)) {
      if (val !== undefined) {
        updates.push(`"${key}" = $${idx}`);
        values.push(key === "countries" ? JSON.stringify(val) : val);
        idx++;
      }
    }

    if (updates.length === 0) {
      return NextResponse.json({ error: "No fields to update" }, { status: 400 });
    }

    // add id and orgId
    values.push(id, organizationId);

    const result = await pool.query(
      `
      UPDATE "shippingMethods"
      SET ${updates.join(", ")}, "updatedAt" = NOW()
      WHERE id = $${idx++} AND "organizationId" = $${idx}
      RETURNING *
    `,
      values
    );

    if (result.rows.length === 0) {
      return NextResponse.json({ error: "Shipping method not found" }, { status: 404 });
    }

    const sm = result.rows[0];
    sm.countries = JSON.parse(sm.countries)
    return NextResponse.json(sm);
  } catch (err: any) {
    console.error("[PATCH /api/shipping-companies/[id]]", err);
    const status = err instanceof z.ZodError ? 400 : err.message.includes("Unauthorized") ? 403 : 500;
    const payload = err instanceof z.ZodError ? { error: err.errors } : { error: err.message };
    return NextResponse.json(payload, { status });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { organizationId } = ctx;

  try {
    const { id } = await params;

    const { rows } = await pool.query(
      `
      DELETE FROM "shippingMethods"
      WHERE id = $1 AND "organizationId" = $2
      RETURNING *
    `,
      [id, organizationId]
    );

    if (rows.length === 0) {
      return NextResponse.json({ error: "Shipping method not found" }, { status: 404 });
    }

    return NextResponse.json({ message: "Deleted successfully" });
  } catch (err: any) {
    console.error("[DELETE /api/shipping-companies/[id]]", err);
    const status = err.message.includes("Unauthorized") ? 403 : 500;
    return NextResponse.json({ error: err.message }, { status });
  }
}
