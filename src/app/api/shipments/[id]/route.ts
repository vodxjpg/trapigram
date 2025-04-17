// File: src/app/api/shipments/[id]/route.ts

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Pool } from "pg";
import { auth } from "@/lib/auth";

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
});
const INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET as string;

const costGroupSchema = z.object({
    minOrderCost: z.coerce
      .number()
      .min(0, "Minimum order cost must be 0 or greater"),
    maxOrderCost: z.coerce
      .number()
      .min(0, "Maximum order cost must be 0 or greater"),
    shipmentCost: z.coerce
      .number()
      .min(0, "Shipment cost must be 0 or greater"),
  });
  
  // PATCH body schema now expects an array of those
  const shipmentUpdateSchema = z.object({
    title: z.string().min(1, "Title is required").optional(),
    description: z.string().min(1, "Description is required").optional(),
    countries: z.array(z.string()).optional(),
    costs: z.array(costGroupSchema).optional(),
  });

async function getOrgId(req: NextRequest, explicitOrgId?: string) {
    const apiKey = req.headers.get("x-api-key");
    const internalSecret = req.headers.get("x-internal-secret");
    let organizationId: string;

    const session = await auth.api.getSession({ headers: req.headers });
    if (session) {
        organizationId = explicitOrgId || session.session.activeOrganizationId;
        if (!organizationId) throw new Error("No active organization in session");
    } else if (apiKey) {
        const { valid, key, error } = await auth.api.verifyApiKey({ body: { key: apiKey } });
        if (!valid || !key) throw new Error(error?.message || "Invalid API key");
        organizationId = explicitOrgId || "";
        if (!organizationId) throw new Error("Organization ID is required in query params");
    } else if (internalSecret === INTERNAL_API_SECRET) {
        const internalSession = await auth.api.getSession({ headers: req.headers });
        if (!internalSession) throw new Error("Unauthorized session");
        organizationId = explicitOrgId || internalSession.session.activeOrganizationId;
        if (!organizationId) throw new Error("No active organization in session");
    } else {
        throw new Error("Unauthorized");
    }

    return organizationId;
}

export async function GET(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params;
        const { searchParams } = new URL(req.url);
        const explicitOrgId = searchParams.get("organizationId") || undefined;
        const organizationId = await getOrgId(req, explicitOrgId);

        const result = await pool.query(
            `
      SELECT id, "organizationId", title, description, countries, costs, "createdAt", "updatedAt"
      FROM shipments
      WHERE id = $1 AND "organizationId" = $2
    `,
            [id, organizationId]
        );
        if (result.rows.length === 0) {
            return NextResponse.json({ error: "Shipment not found" }, { status: 404 });
        }
        const shipment = result.rows[0];
        shipment.countries = JSON.parse(shipment.countries);
        shipment.costs = JSON.parse(shipment.costs);
        return NextResponse.json(shipment);
    } catch (err: any) {
        console.error("[GET /api/shipments/[id]]", err);
        if (err.message === "Unauthorized") {
            return NextResponse.json({ error: err.message }, { status: 403 });
        }
        return NextResponse.json({ error: err.message || "Internal server error" }, { status: 500 });
    }
}

export async function PATCH(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params;
        const { searchParams } = new URL(req.url);
        const explicitOrgId = searchParams.get("organizationId") || undefined;
        const organizationId = await getOrgId(req, explicitOrgId);

        const body = await req.json();
        
        body.countries = JSON.parse(body.countries)
        body.costs = JSON.parse(body.costs)
        console.log(typeof(body.costs))
        const parsed = shipmentUpdateSchema.parse(body);
        

        const updates: string[] = [];
        const values: any[] = [];
        let idx = 1;

        for (const [key, val] of Object.entries(parsed)) {
            if (val !== undefined) {
                updates.push(`"${key}" = $${idx++}`);
                // countries and costs live in JSON/text columns
                values.push(key === "countries" || key === "costs" ? JSON.stringify(val) : val);
            }
        }
        if (updates.length === 0) {
            return NextResponse.json({ error: "No fields to update" }, { status: 400 });
        }

        // add id + orgId to where clause
        values.push(id, organizationId);
        const query = `
      UPDATE shipments
      SET ${updates.join(", ")}, "updatedAt" = NOW()
      WHERE id = $${idx++} AND "organizationId" = $${idx}
      RETURNING *
    `;
        const result = await pool.query(query, values);
        if (result.rows.length === 0) {
            return NextResponse.json({ error: "Shipment not found" }, { status: 404 });
        }
        const shipment = result.rows[0];
        shipment.countries = JSON.parse(shipment.countries);
        shipment.costs = JSON.parse(shipment.costs);
        return NextResponse.json(shipment);
    } catch (err: any) {
        console.error("[PATCH /api/shipments/[id]]", err);
        if (err instanceof z.ZodError) {
            return NextResponse.json({ error: err.errors }, { status: 400 });
        }
        if (err.message === "Unauthorized") {
            return NextResponse.json({ error: err.message }, { status: 403 });
        }
        return NextResponse.json({ error: err.message || "Internal server error" }, { status: 500 });
    }
}

export async function DELETE(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params;
        const { searchParams } = new URL(req.url);
        const explicitOrgId = searchParams.get("organizationId") || undefined;
        const organizationId = await getOrgId(req, explicitOrgId);

        const result = await pool.query(
            `
      DELETE FROM shipments
      WHERE id = $1 AND "organizationId" = $2
      RETURNING *
    `,
            [id, organizationId]
        );
        if (result.rows.length === 0) {
            return NextResponse.json({ error: "Shipment not found" }, { status: 404 });
        }
        return NextResponse.json({ message: "Shipment deleted" });
    } catch (err: any) {
        console.error("[DELETE /api/shipments/[id]]", err);
        if (err.message === "Unauthorized") {
            return NextResponse.json({ error: err.message }, { status: 403 });
        }
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}
