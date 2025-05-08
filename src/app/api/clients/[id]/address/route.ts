// app/api/clients/[id]/address/route.ts

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Pool } from "pg";
import { auth } from "@/lib/auth";
import { v4 as uuidv4 } from "uuid";

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
});
const INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET as string;

// --- validation schema for creating an address ---
const addressCreateSchema = z.object({
    clientId: z.string().uuid(),
    address: z.string().min(1, "Address is required"),
    postalCode: z.string().min(1, "Postal code is required"),
    phone: z.string().min(1, "Phone number is required"),
});

export async function GET(
    req: NextRequest,
    { params }: { params: { id: string } }
) {
    // --- authentication boilerplate (same as your coupons endpoint) ---
    const apiKey = req.headers.get("x-api-key");
    const internalSecret = req.headers.get("x-internal-secret");
    let organizationId: string;
    const { searchParams } = new URL(req.url);
    const explicitOrgId = searchParams.get("organizationId");

    // Case 1: session-based
    const session = await auth.api.getSession({ headers: req.headers });
    if (session) {
        organizationId = explicitOrgId || session.session.activeOrganizationId;
        if (!organizationId) {
            return NextResponse.json(
                { error: "No active organization in session" },
                { status: 400 }
            );
        }
    }
    // Case 2: API key
    else if (apiKey) {
        const { valid, error, key } = await auth.api.verifyApiKey({ body: { key: apiKey } });
        if (!valid || !key) {
            return NextResponse.json(
                { error: error?.message || "Invalid API key" },
                { status: 401 }
            );
        }
        organizationId = explicitOrgId || "";
        if (!organizationId) {
            return NextResponse.json(
                { error: "Organization ID required in query params" },
                { status: 400 }
            );
        }
    }
    // Case 3: internal secret
    else if (internalSecret === INTERNAL_API_SECRET) {
        const internalSession = await auth.api.getSession({ headers: req.headers });
        if (!internalSession) {
            return NextResponse.json(
                { error: "Unauthorized session" },
                { status: 401 }
            );
        }
        organizationId =
            explicitOrgId || internalSession.session.activeOrganizationId;
        if (!organizationId) {
            return NextResponse.json(
                { error: "No active organization in session" },
                { status: 400 }
            );
        }
    } else {
        return NextResponse.json(
            { error: "Unauthorized" },
            { status: 403 }
        );
    }

    try {
        const clientId = params.id;
        console.log(clientId)
        const result = await pool.query(
            `SELECT id, "clientId", address, "postalCode", phone
       FROM "clientAddresses"
       WHERE "clientId" = $1`,
            [clientId]
        );
        console.log(result.rows)
        return NextResponse.json({ addresses: result.rows });
    } catch (error: any) {
        console.error("[GET /api/clients/[id]/address] error:", error);
        return NextResponse.json(
            { error: "Internal server error" },
            { status: 500 }
        );
    }
}

export async function POST(
    req: NextRequest,
    { params }: { params: { id: string } }
) {
    // --- same auth logic as above ---
    const apiKey = req.headers.get("x-api-key");
    const internalSecret = req.headers.get("x-internal-secret");
    let organizationId: string;
    const { searchParams } = new URL(req.url);
    const explicitOrgId = searchParams.get("organizationId");

    const session = await auth.api.getSession({ headers: req.headers });
    if (session) {
        organizationId = explicitOrgId || session.session.activeOrganizationId;
        if (!organizationId) {
            return NextResponse.json(
                { error: "No active organization in session" },
                { status: 400 }
            );
        }
    } else if (apiKey) {
        const { valid, error, key } = await auth.api.verifyApiKey({ body: { key: apiKey } });
        if (!valid || !key) {
            return NextResponse.json(
                { error: error?.message || "Invalid API key" },
                { status: 401 }
            );
        }
        organizationId = explicitOrgId || "";
        if (!organizationId) {
            return NextResponse.json(
                { error: "Organization ID required in query params" },
                { status: 400 }
            );
        }
    } else if (internalSecret === INTERNAL_API_SECRET) {
        const internalSession = await auth.api.getSession({ headers: req.headers });
        if (!internalSession) {
            return NextResponse.json(
                { error: "Unauthorized session" },
                { status: 401 }
            );
        }
        organizationId =
            explicitOrgId || internalSession.session.activeOrganizationId;
        if (!organizationId) {
            return NextResponse.json(
                { error: "No active organization in session" },
                { status: 400 }
            );
        }
    } else {
        return NextResponse.json(
            { error: "Unauthorized" },
            { status: 403 }
        );
    }

    try {
        const clientId = params.id;        
        const body = await req.json();

        const parsed = addressCreateSchema.parse({
            ...body,
            clientId,
        });

        const addressId = uuidv4();

        // insert
        const insertQ = `
      INSERT INTO "clientAddresses" (id, "clientId", address, "postalCode", phone)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id, "clientId", address, "postalCode", phone
    `;
        const values = [
            addressId,
            parsed.clientId,
            parsed.address,
            parsed.postalCode,
            parsed.phone,
        ];
        const result = await pool.query(insertQ, values);
        const newAddress = result.rows[0];

        return NextResponse.json(newAddress, { status: 201 });
    } catch (error: any) {
        console.error("[POST /api/clients/[id]/address] error:", error);
        if (error instanceof z.ZodError) {
            return NextResponse.json({ error: error.errors }, { status: 400 });
        }
        return NextResponse.json(
            { error: "Internal server error" },
            { status: 500 }
        );
    }
}
