// src/app/api/order/[id]/tracking-number/route.ts
import { NextRequest, NextResponse } from "next/server";
import { pgPool as pool } from "@/lib/db";
import { getContext } from "@/lib/context";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { organizationId } = ctx;

  try {
    const { id } = await params;
    const { trackingNumber, shippingCompany } = await req.json();

    // 1) Update ONLY tracking fields; do NOT mutate status here.
    //    Status transitions must go through /change-status so notifications fire.
    const sql = `
      UPDATE orders
         SET "trackingNumber" = $1,
             "shippingService" = $2,
             "updatedAt" = NOW()
       WHERE id = $3
         AND "organizationId" = $4
       RETURNING id, status, "trackingNumber", "shippingService"
    `;
    const { rows } = await pool.query(sql, [
      trackingNumber ?? null,
      shippingCompany ?? null,
      id,
      organizationId,
    ]);



    if (!rows.length) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }
    
    // 2) Delegate the status transition to the central pipeline so it enqueues notifications.
    //    Forward the caller's cookies to preserve auth/session in getContext.
    try {
      const origin = new URL(req.url).origin;
      const cookie = req.headers.get("cookie") || "";
      await fetch(`${origin}/api/order/${id}/change-status`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...(cookie ? { cookie } : {}),
          accept: "application/json",
        },
        body: JSON.stringify({ status: "completed" }),
        // best-effort; don't block the main response if this aborts
        keepalive: true,
      }).catch(() => { /* ignore network errors; drain/cron can retry */ });
    } catch {
      /* best-effort; /internal/cron/notification-drain will still flush the outbox periodically */
    }

    return NextResponse.json(rows[0], { status: 200 });



  } catch (error) {
    console.error("[PATCH /api/order/:id/tracking-number]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}