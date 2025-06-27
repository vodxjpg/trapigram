// src/app/api/tickets/[id]/messages/route.ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { pgPool as pool } from "@/lib/db";;
import { v4 as uuidv4 } from "uuid";
import { getContext } from "@/lib/context";
import { requireOrgPermission } from "@/lib/perm-server";

// nothing
/** Helper to check if the caller is the org owner */
async function isOwner(organizationId: string, userId: string) {
  const { rowCount } = await pool.query(
    `SELECT 1
       FROM member
      WHERE "organizationId" = $1
        AND "userId"        = $2
        AND role            = 'owner'
      LIMIT 1`,
    [organizationId, userId]
  );
  return rowCount > 0;
}

// Zod schema for validating incoming message
const messagesSchema = z.object({
  message: z.string().min(1, "Message is required."),
  attachments: z.string(),
  isInternal: z.boolean(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // 1) context + update guard
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { organizationId, userId } = ctx;

  if (!(await isOwner(organizationId, userId))) {
    const guard = await requireOrgPermission(req, { ticket: ["update"] });
    if (guard) {
      return NextResponse.json(
        { error: "You don’t have permission to post messages" },
        { status: 403 }
      );
    }
  }

  try {
    const { id } = await params;

    // 2) normalize inputs
    const raw = await req.json();
    const messageText =
      typeof raw.message === "string"
        ? raw.message.trim()
        : typeof raw.text === "string"
        ? raw.text.trim()
        : typeof raw.content === "string"
        ? raw.content.trim()
        : "";

    if (!messageText) {
      return NextResponse.json(
        { error: "Message is required in the request body." },
        { status: 400 }
      );
    }

    const attachmentsStr =
      typeof raw.attachments === "string"
        ? raw.attachments
        : JSON.stringify(raw.attachments ?? []);

    const isInternal = req.headers.get("x-is-internal") === "true";

    // 3) validate schema
    const parsed = messagesSchema.parse({
      message: messageText,
      attachments: attachmentsStr,
      isInternal,
    });

    // 4) insert
    const messageId = uuidv4();
    const result = await pool.query(
      `
      INSERT INTO "ticketMessages"
        (id, "ticketId", message, attachments, "isInternal", "createdAt", "updatedAt")
      VALUES
        ($1, $2, $3, $4, $5, NOW(), NOW())
      RETURNING *;
      `,
      [
        messageId,
        id,
        parsed.message,
        parsed.attachments,
        parsed.isInternal,
      ]
    );

    const saved = result.rows[0];
    // parse attachments JSON back to array
    saved.attachments = JSON.parse(saved.attachments);

    // 5) bump ticket to in-progress if not first message
    const countRes = await pool.query(
      `SELECT COUNT(*) FROM "ticketMessages" WHERE "ticketId" = $1`,
      [id]
    );
    if (Number(countRes.rows[0].count) > 1) {
      await pool.query(
        `UPDATE tickets SET status = 'in-progress' WHERE id = $1`,
        [id]
      );
    }

    return NextResponse.json(saved, { status: 201 });
  } catch (err: any) {
    console.error("[POST /api/tickets/[id]/messages] error:", err);
    if (err instanceof z.ZodError) {
      // send validation errors
      return NextResponse.json(
        { error: err.errors.map((e) => e.message).join("; ") },
        { status: 400 }
      );
    }
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
