// /src/app/api/tickets/[id]/messages/route.ts

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Pool } from "pg";
import { v4 as uuidv4 } from "uuid";
import { getContext } from "@/lib/context";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// Messages schema 
const messagesSchema = z.object({
  message: z.string().min(1, { message: "Message is required." }),
  attachments: z.string(),
  isInternal: z.boolean(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  try {
    const { id } = await params;
    const internalHeader = req.headers.get("x-is-internal");
    const raw = await req.json();

    // Normalize message: accept either `raw.message` or `raw.text`
    const messageText =
    typeof raw.message === "string"  ? raw.message.trim()  :
    typeof raw.text    === "string"  ? raw.text.trim()     :
    typeof raw.content === "string"  ? raw.content.trim()  :
    "";
  
  if (!messageText) {
    return NextResponse.json(
      { error: "Message is required in the request body." },
      { status: 400 }
    );
  }

    // Ensure attachments is a JSON string
    const attachments = typeof raw.attachments === "string"
      ? raw.attachments
      : JSON.stringify(raw.attachments ?? []);

    // Derive isInternal from header
    const isInternal = internalHeader === "true";

    // Zod parse
    const { message, attachments: atts, isInternal: internalFlag } =
      messagesSchema.parse({ message: messageText, attachments, isInternal });

    // --- 3) Insert into DB ---
    const messageId = uuidv4();
    const insertQuery = `
      INSERT INTO "ticketMessages"
        (id, "ticketId", message, attachments, "isInternal", "createdAt", "updatedAt")
      VALUES
        ($1, $2, $3, $4, $5, NOW(), NOW())
      RETURNING *;
    `;
    const values = [messageId, id, message, atts, internalFlag];
    const result = await pool.query(insertQuery, values);
    const saved = result.rows[0];
    saved.attachments = JSON.parse(saved.attachments);

    // If this is the *second* (or later) message, bump ticket to in-progress
    const countRes = await pool.query(
      `SELECT COUNT(*) FROM "ticketMessages" WHERE "ticketId" = $1`,
      [id]
    );
    const count = Number(countRes.rows[0].count);
    if (count > 1) {
      await pool.query(
        `UPDATE "tickets" SET status = 'in-progress' WHERE id = $1`,
        [id]
      );
    }

    return NextResponse.json(saved, { status: 201 });

  } catch (err: any) {
    console.error("[POST /api/tickets/[id]/messages] error:", err);
    // If it was a ZodError, return 400
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: err.errors.map(e => e.message).join("; ") },
        { status: 400 }
      );
    }
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
