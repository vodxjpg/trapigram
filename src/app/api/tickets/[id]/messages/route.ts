// src/app/api/tickets/[id]/messages/route.ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { pgPool as pool } from "@/lib/db";;
import { v4 as uuidv4 } from "uuid";
import { getContext } from "@/lib/context";
import { requireOrgPermission } from "@/lib/perm-server";
import {
  sendNotification,   // notification dispatcher
  NotificationChannel // enum helper
} from "@/lib/notifications";

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

/* ---------- validation schema ---------- */
const messagesSchema = z.object({
  message:     z.string().min(1, "Message is required."),
  attachments: z.string(),
  isInternal:  z.boolean(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  /* 1️⃣ context + permission guard */
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { organizationId, userId } = ctx;

  if (!(await isOwner(organizationId, userId))) {
    const guard = await requireOrgPermission(req, { ticket: ["update"] });
    if (guard)
      return NextResponse.json(
        { error: "You don’t have permission to post messages" },
        { status: 403 },
      );
  }

  try {
    const { id } = await params;

    /* 2️⃣ normalise inputs */
    const raw = await req.json();
    const messageText =
      typeof raw.message === "string"
        ? raw.message.trim()
        : typeof raw.text === "string"
        ? raw.text.trim()
        : typeof raw.content === "string"
        ? raw.content.trim()
        : "";

    if (!messageText)
      return NextResponse.json(
        { error: "Message is required in the request body." },
        { status: 400 },
      );

    const attachmentsStr =
      typeof raw.attachments === "string"
        ? raw.attachments
        : JSON.stringify(raw.attachments ?? []);

    const isInternal = req.headers.get("x-is-internal") === "true";

    /* 3️⃣ validate */
    const parsed = messagesSchema.parse({
      message: messageText,
      attachments: attachmentsStr,
      isInternal,
    });

    /* 4️⃣ insert into DB */
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
      ],
    );

    const saved = result.rows[0];
    saved.attachments = JSON.parse(saved.attachments); // back to array for the client

    /* 4️⃣-bis notify client on public reply */
    if (!parsed.isInternal) {
      // look up clientId for this ticket
      const { rows } = await pool.query(
        `SELECT "clientId" FROM tickets WHERE id = $1 LIMIT 1`,
        [id],
      );
      const clientId = rows[0]?.clientId ?? null;

      const channels: NotificationChannel[] = ["email", "in_app"];
      await sendNotification({
        organizationId,
        type:    "ticket_replied",
        message: `Update on your ticket: <strong>${messageText}</strong>`,
        subject: `Reply on ticket #${id}`,
        variables: {
          ticket_number: id,           // ★ NEW placeholder
          ticket_id:     id,
        },
        channels,
        clientId,
      });
    }

    /* 5️⃣ bump ticket status */
    const countRes = await pool.query(
      `SELECT COUNT(*) FROM "ticketMessages" WHERE "ticketId" = $1`,
      [id],
    );
    if (Number(countRes.rows[0].count) > 1) {
      await pool.query(
        `UPDATE tickets SET status = 'in-progress' WHERE id = $1`,
        [id],
      );
    }

    return NextResponse.json(saved, { status: 201 });
  } catch (err: any) {
    console.error("[POST /api/tickets/[id]/messages] error:", err);
    if (err instanceof z.ZodError)
      return NextResponse.json(
        { error: err.errors.map((e) => e.message).join("; ") },
        { status: 400 },
      );
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
