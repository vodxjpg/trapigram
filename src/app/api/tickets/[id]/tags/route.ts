import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Pool } from "pg";
import { auth } from "@/lib/auth";
import { v4 as uuidv4 } from "uuid";

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
});

const INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET as string;

const tagSchema = z.object({
    description: z.string().min(1, { message: "Description is required." }),
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
            return NextResponse.json({ error: "Organization ID is required in query parameters" }, { status: 400 });
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

    const { id } = await params;

    // Updated SELECT query to include "expendingMinimum"
    const tagsQuery = `
            SELECT
            t.description
            FROM tags AS t
            JOIN "ticketTags" AS tt
            ON tt."tagId" = t.id
            WHERE tt."ticketId" = $1;
  `;
    const values = [id];

    const allTag = `SELECT description FROM tags`

    try {
        const countResult = await pool.query(tagsQuery, values);
        const allTags = await pool.query(allTag)

        const tags = countResult.rows;
        const tagList = allTags.rows;

        return NextResponse.json({
            tags,
            tagList
        });
    } catch (error: any) {
        console.error("[GET /api/tickets/:id/tags] error:", error);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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
            return NextResponse.json({ error: "Organization ID is required in query parameters" }, { status: 400 });
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
        return NextResponse.json({ error: "Unauthorized: Provide a valid session, API key, or internal secret" }, { status: 403 });
    }

    const { id } = await params;

    const updateTags = `DELETE FROM "ticketTags" WHERE "ticketId"='${id}'`
    await pool.query(updateTags);

    try {
        const body = await req.json();
        body.tags.map(async (tag) => {

            const checkTags = `
            SELECT * FROM tags WHERE description = '${tag}'
            `
            const checked = await pool.query(checkTags);
            if (checked.rowCount === 0) {

                const tagId = uuidv4();
                const insertQuery = `
                INSERT INTO tags(id, description, "createdAt", "updatedAt")
                VALUES($1, $2, NOW(), NOW())
                RETURNING *
                `;
                const values = [
                    tagId,
                    tag,
                ];

                await pool.query(insertQuery, values);
            }

            const newTag = `
            SELECT id FROM tags WHERE description = '${tag}'
            `
            const nTag = await pool.query(newTag);
            const tagId = nTag.rows[0].id
            const ticketTagId = uuidv4();
            const insertTagQuery = `
                INSERT INTO "ticketTags"(id, "ticketId", "tagId", "createdAt", "updatedAt")
                VALUES($1, $2, $3, NOW(), NOW())
                RETURNING *
                `;

            const tagValues = [
                ticketTagId,
                id,
                tagId
            ]

            await pool.query(insertTagQuery, tagValues);
        })
        return NextResponse.json({ status: 201 });
    } catch (error: any) {
        console.error("[POST /api/tickets/:id/tags] error:", error);
        if (error instanceof z.ZodError) {
            return NextResponse.json({ error: error.errors }, { status: 400 });
        }
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}
