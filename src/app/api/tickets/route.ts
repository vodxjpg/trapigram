// src/app/api/tickets/route.ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { pgPool as pool } from "@/lib/db";
import { v4 as uuidv4 } from "uuid";
import { getContext } from "@/lib/context";
import { sendNotification } from "@/lib/notifications";
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

// src/app/api/tickets/route.ts (GET)
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
    // Lazy sweep: close tickets whose lastMessageAt is > 24h ago
    // (uses ONLY tickets.lastMessageAt; leaves NULLs untouched)
    // ─────────────────────────────────────────────────────────────
    await pool.query(
      `
      UPDATE tickets
         SET status = 'closed',
             "updatedAt" = NOW()
       WHERE "organizationId" = $1
         AND status <> 'closed'
         AND "lastMessageAt" IS NOT NULL
         AND "lastMessageAt" < NOW() - INTERVAL '24 hours'
      `,
      [organizationId],
    );

    // ---------- build WHERE (two variants: count vs. list with alias) ----------
    const whereCount: string[] = [`"organizationId" = $1`];
    const whereList: string[] = [`t."organizationId" = $1`];
    const values: any[] = [organizationId];

    if (search) {
      values.push(`%${search}%`);
      const idx = values.length;
      whereCount.push(`title ILIKE $${idx}`);
      whereList.push(`t.title ILIKE $${idx}`);
    }
    if (clientId) {
      values.push(clientId);
      const idx = values.length;
      whereCount.push(`"clientId" = $${idx}`);
      whereList.push(`t."clientId" = $${idx}`);
    }

    // ---------- count ----------
    const countSQL = `SELECT COUNT(*) FROM tickets WHERE ${whereCount.join(" AND ")}`;
    const countRows = await pool.query(countSQL, values);
    const totalRows = Number(countRows.rows[0].count) || 0;
    const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));

    // ---------- list ----------
    const listValues = [...values, pageSize, (page - 1) * pageSize];
    const listSQL = `
      SELECT
        t.id,
        t."organizationId",
        t."clientId",
        t.title,
        t.priority,
        t.status,
        t."ticketKey",
        t."lastMessageAt",
        t."createdAt",
        t."updatedAt",
        /* 👇 add customer identity for table subtitle */
        c."firstName" AS "firstName",
        c."lastName"  AS "lastName",
        c.username    AS "username"
      FROM tickets t
      LEFT JOIN clients c ON c.id = t."clientId"
      WHERE ${whereList.join(" AND ")}
      ORDER BY t."createdAt" DESC
      LIMIT $${listValues.length - 1} OFFSET $${listValues.length};
    `;
    const tickets = (await pool.query(listSQL, listValues)).rows;

    return NextResponse.json(
      { tickets, totalPages, currentPage: page },
      { status: 200 }
    );
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

    // ── Atomic: get next key + insert, under the same transaction & client ──
    await client.query("BEGIN");

    const ticketId = uuidv4();
    const ticketKey = await getNextTicketKeyTx(client, organizationId); // ← await!

    const insertSQL = `
      INSERT INTO tickets
        (id, "organizationId", "clientId",
         title, priority, status, "ticketKey",
         "lastMessageAt", "createdAt", "updatedAt")
      VALUES ($1,$2,$3,$4,$5,$6,$7,NOW(),NOW(),NOW())
      RETURNING *;
    `;

    const inserted = (await client.query(insertSQL, [
      ticketId,
      organizationId,
      data.clientId,
      data.title,
      data.priority,
      data.status,
      ticketKey,              // now a number, not {}
    ])).rows[0];

    await client.query("COMMIT");

    // ── Non-transactional work after commit ────────────────────────────
    const { rows: [cli] } = await pool.query(
      `SELECT country FROM clients WHERE id = $1 LIMIT 1`,
      [data.clientId],
    );
    const clientCountry = cli?.country ?? null;

    // (Optional) Keep subject/variables as-is. If you want, include the human key:
    // subject: `Ticket #${ticketKey} created`,
    await sendNotification({
      organizationId,
      type: "ticket_created",
      subject: `Ticket #${ticketKey} created`,
      message: `New ticket created: <strong>${inserted.title}</strong>`,
      variables: {
        // Use the human ticket number for templates
        ticket_number: String(ticketKey),
        // Back-compat if any old templates reference it
        ticket_id: ticketId,
        ticket_title: inserted.title,
        // optionally add: ticket_key: String(ticketKey)
        // New placeholder – content (none at creation time)
        ticket_content: "",
        // optionally: ticket_key: String(ticketKey)
      },
      channels: ["email", "in_app"],
      trigger: "admin_only",           // ← makes this an admin/team notification
      clientId: inserted.clientId,
      ticketId: ticketId,
      country: clientCountry,
      url: `/tickets/${ticketId}`,
    });

    return NextResponse.json(inserted, { status: 201 });
  } catch (err: any) {
    try { await client.query("ROLLBACK"); } catch { }
    console.error("[POST /api/tickets] error:", err);
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.errors }, { status: 400 });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  } finally {
    client.release();
  }
}
