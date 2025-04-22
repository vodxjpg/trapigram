import { NextRequest, NextResponse } from "next/server";
import { Pool } from "pg";
import { auth } from "@/lib/auth";
import { z } from "zod";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET as string;

/* ---------- validation helpers ---------- */
const uuid = z.string().uuid("Invalid ticketId");

/* ---------- GET /api/tickets/[ticketId] ---------- */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
   // Authenticate request as before.
   const apiKey = req.headers.get("x-api-key");
   const internalSecret = req.headers.get("x-internal-secret");
   let organizationId: string;
 
   const { searchParams } = new URL(req.url);
   const explicitOrgId = searchParams.get("organizationId");

  const session = await auth.api.getSession({ headers: req.headers });
  if (session) {
    organizationId = explicitOrgId || session.session.activeOrganizationId;
    if (!organizationId)
      return NextResponse.json({ error: "No active organization in session" }, { status: 400 });
  } else if (apiKey) {
    const { valid, error } = await auth.api.verifyApiKey({ body: { key: apiKey } });
    if (!valid)
      return NextResponse.json({ error: error?.message || "Invalid API key" }, { status: 401 });
    organizationId = explicitOrgId || "";
    if (!organizationId)
      return NextResponse.json({ error: "organizationId is required" }, { status: 400 });
  } else if (internalSecret === INTERNAL_API_SECRET) {
    const s = await auth.api.getSession({ headers: req.headers });
    if (!s) return NextResponse.json({ error: "Unauthorized session" }, { status: 401 });
    organizationId = explicitOrgId || s.session.activeOrganizationId;
    if (!organizationId)
      return NextResponse.json({ error: "No active organization in session" }, { status: 400 });
  } else {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const { id } = await params;

  /* 3 · fetch ticket header + user name */
  const ticketQuery = `
    SELECT tickets.id,
           tickets."organizationId",
           tickets."clientId",
           clients.username,
           tickets.title,
           tickets.priority,
           tickets.status,
           tickets."createdAt"
    FROM   tickets
    JOIN   clients ON tickets."clientId" = clients.id
    WHERE  tickets.id = $1
      AND  tickets."organizationId" = $2
    LIMIT  1;
  `;
  const ticketVals = [id, organizationId];

  /* 4 · fetch messages for that ticket */
  const msgQuery = `
    SELECT id,
           "ticketId",
           message,
           attachments,
           "isInternal",
           "createdAt"
    FROM   "ticketMessages"
    WHERE  "ticketId" = $1
    ORDER  BY "createdAt" ASC;
  `;

  try {
    const tRes = await pool.query(ticketQuery, ticketVals);
    if (tRes.rows.length === 0)
      return NextResponse.json({ error: "Ticket not found" }, { status: 404 });
    const ticket = tRes.rows[0];

    const mRes = await pool.query(msgQuery, [id]);
    const messages = mRes.rows.map((m) => ({
      ...m,
      attachments: m.attachments ? JSON.parse(m.attachments) : [],      
    }));   

    return NextResponse.json({ ticket, messages });
  } catch (err) {
    console.error("[GET /api/tickets/:id]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
