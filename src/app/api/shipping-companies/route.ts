// src/app/api/shippingMethods/route.ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { pgPool as pool } from "@/lib/db";;
import { v4 as uuidv4 } from "uuid";
import { getContext } from "@/lib/context";

// nothing
// Schema for creating a shipping method
const shippingMethodSchema = z.object({
  name: z.string().min(1, "Name is required"),
  countries: z.array(z.string().length(2)).min(1, "At least one country is required"),
  organizationId: z.string().min(1, { message: "Organization is required." }),
});

export async function GET(req: NextRequest) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { organizationId } = ctx;

  // pagination & optional search
  const { searchParams } = new URL(req.url);
  const page = Number(searchParams.get("page") ?? 1);
  const pageSize = Number(searchParams.get("pageSize") ?? 10);
  const search = searchParams.get("search") || "";

  // count total
  let countQuery = `SELECT COUNT(*) FROM "shippingMethods" WHERE "organizationId" = $1`;
  const countValues: any[] = [organizationId];
  if (search) {
    countQuery += ` AND name ILIKE $2`;
    countValues.push(`%${search}%`);
  }

  // fetch paginated
  let selQuery = `
    SELECT id, "organizationId", name, countries, "createdAt", "updatedAt"
    FROM "shippingMethods"
    WHERE "organizationId" = $1
  `;
  const values: any[] = [organizationId];
  if (search) {
    selQuery += ` AND name ILIKE $2`;
    values.push(`%${search}%`);
  }
  selQuery += ` ORDER BY "createdAt" DESC LIMIT $${values.length + 1} OFFSET $${values.length + 2}`;
  values.push(pageSize, (page - 1) * pageSize);

  try {
    const countRes = await pool.query(countQuery, countValues);
    const totalRows = Number(countRes.rows[0].count);
    const totalPages = Math.ceil(totalRows / pageSize);

    const result = await pool.query(selQuery, values);
    const shippingMethods = result.rows.map((row) => ({
      ...row,
      countries: JSON.parse(row.countries),
    }));

    return NextResponse.json({
   // keep legacy key
   shippingMethods,
   // add normalized alias
   companies: shippingMethods,
   totalPages,
   currentPage: page,
 });
  } catch (err: any) {
    console.error("[GET /api/shippingMethods] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { organizationId } = ctx;

  try {
    const payload = await req.json();
    payload.countries = JSON.parse(payload.countries)
    const parsed = shippingMethodSchema.parse({ ...payload, organizationId });

    const id = uuidv4();
    const url = "https://parcelsapp.com/en/tracking/"
    const insertQ = `
      INSERT INTO "shippingMethods"
        (id, "organizationId", name, countries, url, "createdAt", "updatedAt")
      VALUES ($1,$2,$3,$4,$5,NOW(),NOW())
      RETURNING *
    `;
    const vals = [id, organizationId, parsed.name, JSON.stringify(parsed.countries), url];
    const res = await pool.query(insertQ, vals);
    const created = res.rows[0];
    created.countries = JSON.parse(created.countries);
    return NextResponse.json(created, { status: 201 });
  } catch (err: any) {
    console.error("[POST /api/shipping-companies] error:", err);
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.errors }, { status: 400 });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
