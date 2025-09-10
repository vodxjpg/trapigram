import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { pgPool as pool } from "@/lib/db";
import { getContext } from "@/lib/context";

const channelsEnum = z.enum(["email", "telegram", "in_app", "webhook"]);
const actionEnum = z.enum(["send_coupon", "product_recommendation"]);
const eventEnum = z.enum([
  "order_placed",
  "order_pending_payment",
  "order_paid",
  "order_completed",
  "order_cancelled",
  "order_refunded",
  "order_partially_paid",
  "order_shipped",
  "order_message",
  "ticket_created",
  "ticket_replied",
  "manual",
]);

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  enabled: z.boolean().optional(),
  priority: z.coerce.number().int().min(0).optional(),
  event: eventEnum.optional(),
  countries: z.array(z.string()).optional(),
  orderCurrencyIn: z.array(z.string()).optional(),
  action: actionEnum.optional(),
  channels: z.array(channelsEnum).optional(),
  payload: z.record(z.any()).optional(),
});

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { organizationId } = ctx;
  const { id } = params;

  try {
    const res = await pool.query(
      `
      SELECT id, "organizationId", name, description, enabled, priority,
             event, countries, "orderCurrencyIn",
             action, channels, payload, "createdAt", "updatedAt"
      FROM "automationRules"
      WHERE id = $1 AND "organizationId" = $2
      `,
      [id, organizationId],
    );
    if (!res.rowCount) return NextResponse.json({ error: "Rule not found" }, { status: 404 });

    const row = res.rows[0];
    row.countries = JSON.parse(row.countries || "[]");
    row.orderCurrencyIn = JSON.parse(row.orderCurrencyIn || "[]");
    row.channels = JSON.parse(row.channels || "[]");

    return NextResponse.json(row);
  } catch (e) {
    console.error("[GET /api/rules/:id] error", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { organizationId } = ctx;
  const { id } = params;

  try {
    const body = await req.json();
    const parsed = updateSchema.parse(body);

    const updates: string[] = [];
    const values: any[] = [];
    let i = 1;

    for (const [key, value] of Object.entries(parsed)) {
      if (value === undefined) continue;

      if (key === "countries" || key === "orderCurrencyIn" || key === "channels") {
        updates.push(`"${key}" = $${i++}`);
        values.push(JSON.stringify(value));
      } else if (key === "payload") {
        updates.push(`"payload" = $${i++}`);
        values.push(JSON.stringify(value));
      } else {
        updates.push(`"${key}" = $${i++}`);
        values.push(value);
      }
    }

    if (!updates.length) {
      return NextResponse.json({ error: "No fields provided to update" }, { status: 400 });
    }

    values.push(id, organizationId);

    const res = await pool.query(
      `
      UPDATE "automationRules"
      SET ${updates.join(", ")}, "updatedAt" = NOW()
      WHERE id = $${i++} AND "organizationId" = $${i}
      RETURNING *
      `,
      values,
    );

    if (!res.rowCount) return NextResponse.json({ error: "Rule not found" }, { status: 404 });

    const row = res.rows[0];
    row.countries = JSON.parse(row.countries || "[]");
    row.orderCurrencyIn = JSON.parse(row.orderCurrencyIn || "[]");
    row.channels = JSON.parse(row.channels || "[]");

    return NextResponse.json(row);
  } catch (error: any) {
    console.error("[PATCH /api/rules/:id] error", error);
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.errors }, { status: 400 });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { organizationId } = ctx;
  const { id } = params;

  try {
    const res = await pool.query(
      `DELETE FROM "automationRules" WHERE id = $1 AND "organizationId" = $2 RETURNING id`,
      [id, organizationId],
    );
    if (!res.rowCount) return NextResponse.json({ error: "Rule not found" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[DELETE /api/rules/:id] error", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
