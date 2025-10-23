// /src/app/api/announcements/send/[id]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { pgPool as pool } from "@/lib/db";
import { getContext } from "@/lib/context";
import { publish } from "@/lib/pubsub";

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;

  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { organizationId } = ctx;

  try {
    const { rows } = await pool.query(
      `UPDATE announcements
          SET sent = TRUE, "updatedAt" = NOW()
        WHERE id = $1 AND "organizationId" = $2
      RETURNING id, title, content, "deliveryDate", countries, sent, "updatedAt"`,
      [id, organizationId],
    );

    if (!rows.length) {
      return NextResponse.json({ error: "Announcement not found" }, { status: 404 });
    }

    const row = rows[0];
    const countriesArr = (() => {
      try { return JSON.parse(row.countries || "[]"); } catch { return []; }
    })();

    // publish one event for downstream consumers
    await publish(`announcements:org:${organizationId}`, {
      id: row.id,
      orgId: organizationId,
      title: row.title,
      content: row.content,
      countries: countriesArr,
      deliveryDate: row.deliveryDate,
      updatedAt: row.updatedAt,
    });

    return NextResponse.json(row);
  } catch (error: any) {
    console.error("[PATCH /api/announcements/send/[id]] error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
