import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Pool } from "pg";
import { auth } from "@/lib/auth";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});
const INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET as string;

const couponUpdateSchema = z.object({
  name: z.string().min(1, { message: "Name is required." }).optional(),
  code: z.string().min(1, { message: "Code is required." }).optional(),
  description: z.string().min(1, { message: "Description is required." }).optional(),
  expirationDate: z.string().optional().nullable(),
  limitPerUser: z.coerce.number().int().min(0, { message: "Limit per user must be at least 0." }).optional(),
  usageLimit: z.coerce.number().int().min(0, { message: "Usage limit must be at least 0." }).optional(),
  expendingLimit: z.coerce.number().int().min(0, { message: "Expending limit must be at least 0." }).optional(),
  countries: z.array(z.string()).optional(),
  visibility: z.boolean().optional(),
});

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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
      return NextResponse.json(
        { error: "Organization ID is required in query parameters" },
        { status: 400 }
      );
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
      SELECT id, "organizationId", name, code, description, "expirationDate", "limitPerUser", "usageLimit", "expendingLimit", countries, visibility, "createdAt", "updatedAt"
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
      return NextResponse.json(
        { error: "Organization ID is required in query parameters" },
        { status: 400 }
      );
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
      return NextResponse.json(
        { error: "Organization ID is required in query parameters" },
        { status: 400 }
      );
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