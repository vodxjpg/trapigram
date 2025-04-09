// File: src/app/api/coupons/[id]/route.ts

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Pool } from "pg";
import { auth } from "@/lib/auth";

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
});
const INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET as string;

// -------------------------------------------------------------------
// Define the coupon update schema using Zod.
// All fields are optional so that you can update any subset of them.
// -------------------------------------------------------------------
const couponUpdateSchema = z.object({
    name: z.string().min(1, { message: "Name is required." }).optional(),
    code: z.string().min(1, { message: "Code is required." }).optional(),
    description: z.string().min(1, { message: "Description is required." }).optional(),
    usageLimit: z.coerce.number().int().min(0, { message: "Usage limit must be at least 0." }).optional(),
    expendingLimit: z.coerce.number().int().min(0, { message: "Expending limit must be at least 0." }).optional(),
    countries: z.array(z.string()).optional(),
    visibility: z.boolean().optional(),
});

// -------------------------------------------------------------------
// GET endpoint: Fetch a coupon by its ID and organization.
// -------------------------------------------------------------------
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
    const apiKey = req.headers.get("x-api-key");
    const internalSecret = req.headers.get("x-internal-secret");
    let organizationId: string;

    const { searchParams } = new URL(req.url);
    const explicitOrgId = searchParams.get("organizationId");

    if (apiKey) {
        const { valid, error, key } = await auth.api.verifyApiKey({ body: { key: apiKey } });
        if (!valid || !key) {
            return NextResponse.json({ error: error?.message || "Invalid API key" }, { status: 401 });
        }
        const session = await auth.api.getSession({ headers: req.headers });
        organizationId = session?.session.activeOrganizationId || "";
        if (!organizationId) {
            return NextResponse.json({ error: "Organization ID is required in query parameters" }, { status: 400 });
        }
    } else if (internalSecret === INTERNAL_API_SECRET) {
        const session = await auth.api.getSession({ headers: req.headers });
        if (!session) {
            return NextResponse.json({ error: "Unauthorized session" }, { status: 401 });
        }
        organizationId = explicitOrgId || session.session.activeOrganizationId;
        if (!organizationId) {
            return NextResponse.json({ error: "No active organization in session" }, { status: 400 });
        }
    } else {
        return NextResponse.json(
            { error: "Unauthorized: Provide either an API key or internal secret" },
            { status: 403 }
        );
    }

    try {
        const { id } = params;
        const query = `
      SELECT id, "organizationId", name, code, description, "usageLimit", "expendingLimit", countries, visibility, "createdAt", "updatedAt"
      FROM coupons
      WHERE id = $1 AND "organizationId" = $2
    `;
        const result = await pool.query(query, [id, organizationId]);
        if (result.rows.length === 0) {
            return NextResponse.json({ error: "Coupon not found" }, { status: 404 });
        }
        return NextResponse.json(result.rows[0]);
    } catch (error: any) {
        console.error("[GET /api/coupons/[id]] error:", error);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}

// -------------------------------------------------------------------
// PATCH endpoint: Update an existing coupon using provided fields.
// -------------------------------------------------------------------
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
    const apiKey = req.headers.get("x-api-key");
    const internalSecret = req.headers.get("x-internal-secret");
    let organizationId: string;

    const { searchParams } = new URL(req.url);
    const explicitOrgId = searchParams.get("organizationId");

    if (apiKey) {
        const { valid, error, key } = await auth.api.verifyApiKey({ body: { key: apiKey } });
        if (!valid || !key) {
            return NextResponse.json({ error: error?.message || "Invalid API key" }, { status: 401 });
        }
        const session = await auth.api.getSession({ headers: req.headers });
        organizationId = session?.session.activeOrganizationId || "";
        if (!organizationId) {
            return NextResponse.json({ error: "Organization ID is required in query parameters" }, { status: 400 });
        }
    } else if (internalSecret === INTERNAL_API_SECRET) {
        const session = await auth.api.getSession({ headers: req.headers });
        if (!session) {
            return NextResponse.json({ error: "Unauthorized session" }, { status: 401 });
        }
        organizationId = explicitOrgId || session.session.activeOrganizationId;
        if (!organizationId) {
            return NextResponse.json({ error: "No active organization in session" }, { status: 400 });
        }
    } else {
        return NextResponse.json(
            { error: "Unauthorized: Provide either an API key or internal secret" },
            { status: 403 }
        );
    }

    try {
        const { id } = params;
        const body = await req.json();
        const parsedCoupon = couponUpdateSchema.parse(body);

        const updates: string[] = [];
        const values: any[] = [];
        let paramIndex = 1;

        // Build dynamic update query based on provided fields.
        for (const [key, value] of Object.entries(parsedCoupon)) {
            if (value !== undefined) {
                updates.push(`"${key}" = $${paramIndex++}`);
                values.push(value);
            }
        }

        if (updates.length === 0) {
            return NextResponse.json({ error: "No fields provided to update" }, { status: 400 });
        }

        // Add coupon id and organization id to the query parameters.
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
        return NextResponse.json(result.rows[0]);
    } catch (error: any) {
        console.error("[PATCH /api/coupons/[id]] error:", error);
        if (error instanceof z.ZodError) {
            return NextResponse.json({ error: error.errors }, { status: 400 });
        }
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}

// -------------------------------------------------------------------
// DELETE endpoint: Delete an existing coupon.
// -------------------------------------------------------------------
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
    const apiKey = req.headers.get("x-api-key");
    const internalSecret = req.headers.get("x-internal-secret");
    let organizationId: string;

    const { searchParams } = new URL(req.url);
    const explicitOrgId = searchParams.get("organizationId");

    if (apiKey) {
        const { valid, error, key } = await auth.api.verifyApiKey({ body: { key: apiKey } });
        if (!valid || !key) {
            return NextResponse.json({ error: error?.message || "Invalid API key" }, { status: 401 });
        }
        const session = await auth.api.getSession({ headers: req.headers });
        organizationId = session?.session.activeOrganizationId || "";
        if (!organizationId) {
            return NextResponse.json({ error: "Organization ID is required in query parameters" }, { status: 400 });
        }
    } else if (internalSecret === INTERNAL_API_SECRET) {
        const session = await auth.api.getSession({ headers: req.headers });
        if (!session) {
            return NextResponse.json({ error: "Unauthorized session" }, { status: 401 });
        }
        organizationId = explicitOrgId || session.session.activeOrganizationId;
        if (!organizationId) {
            return NextResponse.json({ error: "No active organization in session" }, { status: 400 });
        }
    } else {
        return NextResponse.json(
            { error: "Unauthorized: Provide either an API key or internal secret" },
            { status: 403 }
        );
    }

    try {
        const { id } = params;
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
