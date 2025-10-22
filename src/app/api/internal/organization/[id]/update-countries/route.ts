// src/app/api/organizations/[identifier]/update-countries/route.ts
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { pgPool as pool } from "@/lib/db";
import { getContext } from "@/lib/context";

const bodySchema = z.object({
  // allow empty array too, if you want to clear countries just pass []
  countries: z.array(z.string()),
});

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ identifier: string }> } // ← async params
) {
  const { identifier } = await context.params;

  // 1) auth & org check
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  if (ctx.organizationId !== identifier) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // 2) validate body
  const json = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten() },
      { status: 400 }
    );
  }

  // 3) update DB
  try {
    const result = await pool.query(
      `UPDATE "organization"
         SET countries = $1, "updatedAt" = NOW()
       WHERE id = $2`,
      [JSON.stringify(parsed.data.countries), identifier]
    );

    if (result.rowCount === 0) {
      return NextResponse.json(
        { error: "Organization not found" },
        { status: 404 }
      );
    }

    return NextResponse.json(
      { message: "Countries updated successfully" },
      { status: 200 }
    );
  } catch (err) {
    console.error(
      "[POST /api/organizations/[identifier]/update-countries] error:",
      err
    );
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
