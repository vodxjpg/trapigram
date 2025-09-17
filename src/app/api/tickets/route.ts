// src/app/api/tickets/route.ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { pgPool as pool } from "@/lib/db";
import { v4 as uuidv4 } from "uuid";
import { getContext } from "@/lib/context";
import {
  sendNotification,
  NotificationChannel,
} from "@/lib/notifications";
import type { PoolClient } from "pg";

/* ────────────────────────────────────────────────────────────────── *
 * Zod schemas                                                        *
 * ────────────────────────────────────────────────────────────────── */

const ticketSchema = z.object({
  title: z.string().min(1, "Title is required"),
  clientId: z.string().uuid(),
  priority: z.enum(["low", "medium", "high"]).default("medium"),
  status: z.enum(["open", "in-progress", "closed"]).default("open"),
});

/* ────────────────────────────────────────────────────────────────── *
 * GET /api/tickets
 * Optional query: ?page=&pageSize=&search=&clientId=
 * NO permission enforcement                                           *
 * ────────────────────────────────────────────────────────────────── */

/** Get next per-org ticketKey safely within a transaction */
async function getNextTicketKeyTx(client: PoolClient, organizationId: string): Promise<number> {
  // Lock scoped to this org to avoid races from concurrent requests
  await client.query(
    `SELECT pg_advisory_xact_lock(hashtext($1))`,
    [`tickets:${organizationId}`]
  );

  const { rows } = await client.query<{ next: number }>(
    `SELECT COALESCE(MAX("ticketKey"), 0) + 1 AS next
     FROM tickets
     WHERE "organizationId" = $1`,
    [organizationId]
  );
  return Number(rows[0]?.next ?? 1);
}

export async function GET(req: NextRequest) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;

  const { organizationId } = ctx;

  try {
    const { searchParams } = new URL(req.url);
    const page = Math.max(1, Number(searchParams.get("page")) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(searchParams.get("pageSize")) || 10));
    const search = (searchParams.get("search") || "").trim();
    const clientId = searchParams.get("clientId");

    // validate clientId if provided
    if (clientId && !z.string().uuid().safeParse(clientId).success) {
      return NextResponse.json({ error: "Invalid clientId" }, { status: 400 });
    }

    // ─────────────────────────────────────────────────────────────
    // Lazy sweep: close tickets whose *last message* is > 24h ago
    // ─────────────────────────────────────────────────────────────
    await pool.query(
      `
      WITH last AS (
        SELECT "ticketId", MAX("createdAt") AS last_at
          FROM "ticketMessages"
         GROUP BY "ticketId"
      )
      UPDATE tickets t
         SET status = 'closed', "updatedAt" = NOW()
        FROM last
       WHERE t.id = last."ticketId"
         AND t."organizationId" = $1
         AND t.status <> 'closed'
         AND last.last_at < NOW() - INTERVAL '24 hours'
      `,
      [organizationId],
    );

    // build WHERE
    const where: string[] = [`"organizationId" = $1`];
    const values: any[] = [organizationId];

    if (search) {
      values.push(`%${search}%`);
      where.push(`title ILIKE $${values.length}`);
    }
    if (clientId) {
      values.push(clientId);
      where.push(`"clientId" = $${values.length}`);
    }

    // count
    const countSQL = `SELECT COUNT(*) FROM tickets WHERE ${where.join(" AND ")}`;
    const countRows = await pool.query(countSQL, values);
    const totalRows = Number(countRows.rows[0].count) || 0;
    const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));

    // list
    const listValues = [...values, pageSize, (page - 1) * pageSize];
    const listSQL = `
      SELECT id,
             "organizationId", "clientId",
             title, priority, status, "ticketKey",
             "createdAt", "updatedAt"
        FROM tickets
       WHERE ${where.join(" AND ")}
       ORDER BY "createdAt" DESC
       LIMIT $${listValues.length - 1} OFFSET $${listValues.length};
    `;
    const tickets = (await pool.query(listSQL, listValues)).rows;

    return NextResponse.json({
      tickets,
      totalPages,
      currentPage: page,
    }, { status: 200 });
  } catch (err) {
    console.error("[GET /api/tickets] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/* ────────────────────────────────────────────────────────────────── *
 * POST /api/tickets
 * NO permission enforcement                                          *
 * ────────────────────────────────────────────────────────────────── */

export async function POST(req: NextRequest) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { organizationId } = ctx;
  const client = await pool.connect();

  try {
    const data = ticketSchema.parse(await req.json());

    // create ticket
    const ticketId = uuidv4();
    const ticketKey = getNextTicketKeyTx(client, organizationId)
    const insertSQL = `
      INSERT INTO tickets
        (id, "organizationId", "clientId",
         title, priority, status, "ticketKey",
         "createdAt", "updatedAt")
      VALUES ($1,$2,$3,$4,$5,$6,$7,NOW(),NOW())
      RETURNING *;
    `;
    const inserted = (await pool.query(insertSQL, [
      ticketId,
      organizationId,
      data.clientId,
      data.title,
      data.priority,
      data.status,
      ticketKey
    ])).rows[0];

    // notify client
    const { rows: [cli] } = await pool.query(
      `SELECT country FROM clients WHERE id = $1 LIMIT 1`,
      [data.clientId],
    );
    const clientCountry = cli?.country ?? null;

    const channels: NotificationChannel[] = ["email", "in_app"];
    await sendNotification({
      organizationId,
      type: "ticket_created",
      subject: `Ticket #${ticketId} created`,
      message: `New ticket created: <strong>${inserted.title}</strong>`,
      variables: { ticket_number: ticketId, ticket_id: ticketId, ticket_title: inserted.title },
      channels,
      clientId: inserted.clientId,
      ticketId: ticketId,
      country: clientCountry,
      url: `/tickets/${ticketId}`,
    });

    return NextResponse.json(inserted, { status: 201 });
  } catch (err: any) {
    console.error("[POST /api/tickets] error:", err);
    if (err instanceof z.ZodError)
      return NextResponse.json({ error: err.errors }, { status: 400 });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
