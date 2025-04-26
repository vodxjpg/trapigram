import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Pool } from "pg";
import { auth } from "@/lib/auth";

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
});
const INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET as string;

// Messages schema 

const priorityTicketSchema = z.object({
    priority: z.string(),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const apiKey = req.headers.get("x-api-key");
    const internalSecret = req.headers.get("x-internal-secret");
    const priority = req.headers.get("x-priority");

    let organizationId: string;

    const { searchParams } = new URL(req.url);
    const explicitOrgId = searchParams.get("organizationId");

    const session = await auth.api.getSession({ headers: req.headers });

    if (session) {
        organizationId = explicitOrgId || session.session.activeOrganizationId;
        if (!organizationId) {
            return NextResponse.json({ error: "No active organization in session" }, { status: 400 });
        }
    }
    else if (apiKey) {
        const { valid, error, key } = await auth.api.verifyApiKey({ body: { key: apiKey } });
        if (!valid || !key) {
            return NextResponse.json({ error: error?.message || "Invalid API key" }, { status: 401 });
        }
        organizationId = explicitOrgId || "";
        if (!organizationId) {
            return NextResponse.json({ error: "Organization ID is required in query parameters" }, { status: 400 });
        }
    }
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
        return NextResponse.json({ error: "Unauthorized: Provide a valid session, API key, or internal secret" }, { status: 403 });
    }

    try {

        const { id } = await params;

        const insertQuery = `UPDATE "tickets"
            SET priority = $1
            WHERE id = $2`;

        const values = [
            priority,
            id,
        ];

        const result = await pool.query(insertQuery, values);

        return NextResponse.json(result, { status: 201 });

    } catch (error: any) {

        console.error("[POST /api/tickets/[id]/messages] error:", error);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });

    }
}