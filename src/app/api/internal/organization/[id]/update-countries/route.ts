// src/app/api/internal/organization/[id]/update-countries/route.ts
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { pgPool as pool } from "@/lib/db";
import { getContext } from "@/lib/context";

const bodySchema = z.object({
  countries: z.array(z.string()), // allow [] to clear
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }   // <-- MUST be { id }
) {
  const { id } = await params;                      // <-- use id (matches folder)

  // 1) auth & org check
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  if (ctx.organizationId !== id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // 2) validate body
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  // 3) update DB
  try {
    const result = await pool.query(
      `UPDATE "organization"
          SET countries = $1, "updatedAt" = NOW()
        WHERE id = $2`,
      [JSON.stringify(parsed.data.countries), id]
    );

    if (result.rowCount === 0) {
      return NextResponse.json({ error: "Organization not found" }, { status: 404 });
    }

    return NextResponse.json({ message: "Countries updated successfully" }, { status: 200 });
  } catch (err) {
    console.error("[POST /api/internal/organization/[id]/update-countries] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
