import { NextRequest, NextResponse } from "next/server";
import { object, string, z } from "zod";
import { Pool } from "pg";
import { auth } from "@/lib/auth";
import { v4 as uuidv4 } from "uuid";

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
});
const INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET as string;

// Messages schema 

const messagesSchema = z.object({
    message: z.string().min(1, { message: "Message is required." }),
    attachments: z.string(),
    isInternal: z.boolean()
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const apiKey = req.headers.get("x-api-key");
    const internalSecret = req.headers.get("x-internal-secret");
    const internal = req.headers.get("x-is-internal");

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
        const body = await req.json();
        typeof(body.attachments) !== "string" ? body.attachments = "[]" : body.attachments;
        internal === "true" ? body.isInternal = true : body.isInternal = false;
        const parsedMessage = messagesSchema.parse(body);

        const { message, attachments, isInternal } = parsedMessage

        const messageId = uuidv4();

        const insertQuery = `
      INSERT INTO "ticketMessages"(id, "ticketId", message, attachments, "isInternal", "createdAt", "updatedAt")
      VALUES($1, $2, $3, $4, $5, NOW(), NOW())
      RETURNING *
    `;

        const values = [
            messageId,
            id,
            message,
            attachments,
            isInternal,
        ];

        const result = await pool.query(insertQuery, values);
        const messages = result.rows[0];
        messages.attachments = JSON.parse(messages.attachments)

        const amountQuery = `SELECT * FROM "ticketMessages" WHERE "ticketId" = '${id}'`
        const amountResult = await pool.query(amountQuery)
        const amount = amountResult.rows.length
        if (amount > 1) {
            const statusQuery = `UPDATE "tickets"
            SET status = 'in-progress'
            WHERE id = $1`

            const statusValue = [
                id
            ]

            await pool.query(statusQuery, statusValue)
        }

        return NextResponse.json(messages, { status: 201 });

    } catch (error: any) {

        console.error("[POST /api/tickets/[id]/messages] error:", error);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });

    }
}