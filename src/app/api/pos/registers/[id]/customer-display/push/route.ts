import { NextRequest, NextResponse } from "next/server";
import { getContext } from "@/lib/context";
import { pgPool as pool } from "@/lib/db";
import { publishDisplayEvent, type DisplayEvent } from "@/lib/customer-display-bus";

export const runtime = "nodejs";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { organizationId } = ctx;
  const { id: registerId } = await params;

  const { rows } = await pool.query(
    `SELECT "displaySessionId" FROM registers WHERE id=$1 AND "organizationId"=$2 LIMIT 1`,
    [registerId, organizationId]
  );
  if (!rows.length) return NextResponse.json({ error: "Register not found" }, { status: 404 });
  const sessionId = rows[0].displaySessionId as string | null;
  if (!sessionId) return NextResponse.json({ error: "Display not paired" }, { status: 400 });

  const payload = (await req.json()) as DisplayEvent;
  if (!payload || typeof payload.type !== "string") {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  await publishDisplayEvent(registerId, sessionId, payload);
  return NextResponse.json({ ok: true }, { status: 200 });
}
