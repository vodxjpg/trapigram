// src/app/api/announcements/send/[id]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { pgPool as pool } from "@/lib/db";
import { getContext } from "@/lib/context";

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  /* ① ── grab the route param before any await ─────────────────────── */
  const { id } = params;           // ✅ no “await params.id” warning

  /* ② ── now it’s safe to await anything else ──────────────────────── */
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { organizationId } = ctx;

  try {
    const query = `
      UPDATE announcements
      SET sent = TRUE, "updatedAt" = NOW()
      WHERE id = $1 AND "organizationId" = $2
      RETURNING *
    `;
    const values = [id, organizationId];
    const result = await pool.query(query, values);

    if (result.rows.length === 0) {
      return NextResponse.json(
        { error: "Announcement not found" },
        { status: 404 },
      );
    }
    return NextResponse.json(result.rows[0]);
  } catch (error: any) {
    console.error("[PATCH /api/announcements/send/[id]] error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
