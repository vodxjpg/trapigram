// src/app/api/tickets/route.ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { pgPool as pool } from "@/lib/db";
import { v4 as uuidv4 } from "uuid";
import { getContext } from "@/lib/context";
import { requireOrgPermission } from "@/lib/perm-server";
import {
  sendNotification,
  NotificationChannel,
} from "@/lib/notifications";

/* ────────────────────────────────────────────────────────────────── *
 * Helpers                                                            *
 * ────────────────────────────────────────────────────────────────── */

/** Quick check whether the caller is an *owner* of the organisation. */
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
 * GET /api/tickets                                                   *
 * Honours optional ?clientId=… query-param                           *
 * ────────────────────────────────────────────────────────────────── */

export async function GET(req: NextRequest) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;

  const { organizationId, userId } = ctx;

  try {
    /* ── read & normalise query-params ───────────────────────────── */
    const { searchParams } = new URL(req.url);
    const page      = Number(searchParams.get("page"))      || 1;
    const pageSize  = Number(searchParams.get("pageSize"))  || 10;
    const search    = searchParams.get("search")            || "";
    const clientId  = searchParams.get("clientId")          || null;

    /* validate clientId (if present) */
    if (clientId) {
      const ok = z.string().uuid().safeParse(clientId);
      if (!ok.success)
        return NextResponse.json({ error: "Invalid clientId" }, { status: 400 });
    }

    /* owner can see everything; non-owners can **only** see          *
     * their own tickets, even if clientId is not supplied            */
    const callerIsOwner = await isOwner(organizationId, userId);
    const effectiveClientId =
      callerIsOwner ? clientId                           // honour filter or none
                    : clientId ?? null;                  // non-owner: MUST supply

    if (!callerIsOwner && !effectiveClientId) {
      return NextResponse.json(
        { error: "clientId is required for non-owner requests" },
        { status: 403 },
      );
    }

    /* ── dynamic SQL ─────────────────────────────────────────────── */
    const where: string[]  = [`"organizationId" = $1`];
    const values: any[]    = [organizationId];

    if (search) {
      values.push(`%${search}%`);
      where.push(`title ILIKE $${values.length}`);
    }
    if (effectiveClientId) {
      values.push(effectiveClientId);
      where.push(`"clientId" = $${values.length}`);
    }

    /* --- total count --- */
    const countSQL = `SELECT COUNT(*) FROM tickets WHERE ${where.join(" AND ")}`;
    const totalRows = Number((await pool.query(countSQL, values)).rows[0].count);
    const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));

    /* --- paginated list --- */
    values.push(pageSize, (page - 1) * pageSize);            // $n+1  $n+2
    const listSQL = `
      SELECT id,
             "organizationId", "clientId",
             title, priority, status,
             "createdAt", "updatedAt"
        FROM tickets
       WHERE ${where.join(" AND ")}
       ORDER BY "createdAt" DESC
       LIMIT $${values.length - 1} OFFSET $${values.length};
    `;
    const tickets = (await pool.query(listSQL, values)).rows;

    return NextResponse.json({
      tickets,
      totalPages,
      currentPage: page,
    });
  } catch (err) {
    console.error("[GET /api/tickets] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/* ────────────────────────────────────────────────────────────────── *
 * POST /api/tickets  (unchanged apart from small tidy-ups)           *
 * ────────────────────────────────────────────────────────────────── */

export async function POST(req: NextRequest) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { organizationId } = ctx;

  try {
    const data = ticketSchema.parse(await req.json());

    /* create ticket ------------------------------------------------ */
    const ticketId = uuidv4();
    const insertSQL = `
      INSERT INTO tickets
        (id, "organizationId", "clientId",
         title, priority, status,
         "createdAt", "updatedAt")
      VALUES ($1,$2,$3,$4,$5,$6,NOW(),NOW())
      RETURNING *;
    `;
    const inserted = (await pool.query(insertSQL, [
      ticketId,
      organizationId,
      data.clientId,
      data.title,
      data.priority,
      data.status,
    ])).rows[0];

    /* notify client ------------------------------------------------ */
    const { rows: [cli] } = await pool.query(
      `SELECT country FROM clients WHERE id = $1 LIMIT 1`,
      [data.clientId],
    );
    const clientCountry = cli?.country ?? null;

    const channels: NotificationChannel[] = ["email", "in_app"];
    await sendNotification({
      organizationId,
      type:    "ticket_created",
      subject: `Ticket #${ticketId} created`,
      message: `New ticket created: <strong>${inserted.title}</strong>`,
      variables: { ticket_number: ticketId, ticket_id: ticketId, ticket_title: inserted.title },
      channels,
      clientId:  inserted.clientId,
      ticketId:  ticketId,
      country:   clientCountry,
      url:       `/tickets/${ticketId}`,
    });

    return NextResponse.json(inserted, { status: 201 });
  } catch (err: any) {
    console.error("[POST /api/tickets] error:", err);
    if (err instanceof z.ZodError)
      return NextResponse.json({ error: err.errors }, { status: 400 });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
