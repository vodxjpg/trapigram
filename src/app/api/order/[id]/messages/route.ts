import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { pgPool as pool } from "@/lib/db";;
import { v4 as uuidv4 } from "uuid";
import { getContext } from "@/lib/context";
import { requireOrgPermission } from "@/lib/perm-server";

// nothing
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
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { organizationId, userId } = ctx;

  const guard = await requireOrgPermission(req, { orderChat: ["view"] });
  if (guard) return guard;

  try {
    const { id } = await params;
    const isInternal = req.headers.get("x-is-internal") === "true";
    const raw = await req.json();
    const { message, clientId } = messagesSchema.parse(raw);

    /* insert */
    const msgId = uuidv4();
    await pool.query(
      `INSERT INTO "orderMessages"
         (id,"orderId","clientId",message,"isInternal","createdAt")
       VALUES ($1,$2,$3,$4,$5,NOW())`,
      [msgId, id, clientId, message, isInternal],
    );

    /* ─── notify (public only) ─── */
    if (!isInternal) {
      const { rows: [ord] } = await pool.query(
        `SELECT "orderKey","clientId" FROM orders WHERE id = $1`,
        [id],
      );
      const { orderKey, clientId: orderClientId } = ord;
      const { rows: [cli] } = await pool.query(
        `SELECT "userId" FROM clients WHERE id = $1`,
        [orderClientId],
      );

      const customerSent = cli?.userId === userId;
      const channels: NotificationChannel[] = ["email", "in_app"];

      await sendNotification({
        organizationId,
        type: "order_message",
        message: customerSent
          ? `New message from customer on order <strong>#${orderKey}</strong>: ${message}`
          : `Update on your order <strong>#${orderKey}</strong>: ${message}`,
        subject: customerSent
          ? `Customer message on order #${orderKey}`
          : `Reply regarding order #${orderKey}`,
        variables: { order_number: orderKey },
        channels,
        clientId: customerSent ? null : orderClientId,
      });
    }

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err) {
    console.error("[POST /api/order/:id/messages]", err);
    if (err instanceof z.ZodError)
      return NextResponse.json({ error: err.errors }, { status: 400 });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

