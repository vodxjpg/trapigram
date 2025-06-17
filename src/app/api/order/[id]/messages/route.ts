import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Pool } from "pg";
import { v4 as uuidv4 } from "uuid";
import { getContext } from "@/lib/context";
import { requireOrgPermission } from "@/lib/perm-server";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

/* ---------- validation helpers ---------- */
const messagesSchema = z.object({
  message: z.string().min(1, { message: "Message is required." }),
  clientId: z.string(),
  isInternal: z.boolean(),
});

/* ---------- GET /api/order/[orderId]/messages ---------- */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  // authorization: only owners or those with orderChat:view
const guard = await requireOrgPermission(req, { orderChat: ["view"] });
if (guard) return guard;
  try {
    const { id } = await params;

    /* 4 · fetch messages for that order */
    const msgQuery = `
    SELECT om.id,
           om."orderId",
           om."clientId",
           om.message,
           om."isInternal",
           om."createdAt",
           c.email
    FROM   "orderMessages" om
    JOIN clients c ON c.id = om."clientId"
    WHERE  om."orderId" = '${id}'
    ORDER  BY om."createdAt" ASC;
  `;

    const mRes = await pool.query(msgQuery);
    const messages = mRes.rows

    return NextResponse.json({ messages }, { status: 200 });
  } catch (err) {
    console.error("[GET /api/order/:id/messages]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/* ---------- POST /api/order/[orderId]/messages ---------- */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;

  try {
        // authorization: reuse same view permission (or define write, but using view)
    const guard = await requireOrgPermission(req, { orderChat: ["view"] });
    if (guard) return guard;
    const { id } = await params;
    const internalHeader = req.headers.get("x-is-internal");
    const isInternal = internalHeader === "true";
    const data = await req.json();
    const { message, clientId } = data

    const messageId = uuidv4();

    const insertQuery = `
      INSERT INTO "orderMessages"
        (id, "orderId", "clientId", message, "isInternal", "createdAt")
      VALUES
        ($1, $2, $3, $4, $5, NOW())
      RETURNING *;
    `;

    const values = [
      messageId,
      id,
      clientId,
      message,
      isInternal
    ]

    const mRes = await pool.query(insertQuery, values);
    const messages = mRes.rows[0]

    return NextResponse.json({ messages }, { status: 200 });
  } catch (err) {
    console.error("[GET /api/order/:id/messages]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}