import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Pool } from "pg";
import { getContext } from "@/lib/context";

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
});

// Messages schema 

const statusTicketSchema = z.object({
    status: z.string(),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const ctx = await getContext(req);
    if (ctx instanceof NextResponse) return ctx;

    try {

        const { id } = await params;
        const insertQuery = `UPDATE "tickets"
            SET status = $1
            WHERE id = $2`;

        const values = [
            status,
            id,
        ];

        const result = await pool.query(insertQuery, values);

        return NextResponse.json(result, { status: 201 });

    } catch (error: any) {

        console.error("[POST /api/tickets/[id]/messages] error:", error);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });

    }
}