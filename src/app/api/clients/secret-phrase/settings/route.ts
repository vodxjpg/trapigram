import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { pgPool as pool } from "@/lib/db";
import { getContext } from "@/lib/context";

const patchSchema = z.object({
  // targets
  all: z.boolean().optional(),
  clientIds: z.array(z.string()).optional(),   // internal client IDs
  userIds: z.array(z.string()).optional(),     // Telegram chat IDs (stored in clients.userId)

  // settings
  enabled: z.boolean().optional(),
  reverifyAfterDays: z.number().int().min(1).max(365).optional(),
  forceAt: z.string().datetime().optional(),   // ISO 8601
  forceNow: z.boolean().optional(),
});

export async function PATCH(req: NextRequest) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;

  const { organizationId } = ctx;
  if (!organizationId) {
    return NextResponse.json({ error: "No organization in context" }, { status: 404 });
  }

  try {
    const {
      all,
      clientIds,
      userIds,
      enabled,
      reverifyAfterDays,
      forceAt,
      forceNow,
    } = patchSchema.parse(await req.json());

    // ensure we have a target
    if (!all && !clientIds?.length && !userIds?.length) {
      return NextResponse.json(
        { error: "Provide one of: { all: true } | clientIds[] | userIds[]" },
        { status: 400 },
      );
    }

    // build SET clause
    const sets: string[] = [];
    const vals: any[] = [];
    let i = 1;

    if (typeof enabled === "boolean") {
      sets.push(`"secretPhraseEnabled" = $${i++}`);
      vals.push(enabled);
    }
    if (typeof reverifyAfterDays === "number") {
      sets.push(`"secretPhraseReverifyDays" = $${i++}`);
      vals.push(reverifyAfterDays);
    }

    if (forceNow) {
      sets.push(`"secretPhraseForceAt" = NOW()`);
    } else if (forceAt) {
      sets.push(`"secretPhraseForceAt" = $${i++}`);
      vals.push(new Date(forceAt));
    }

    if (!sets.length) {
      return NextResponse.json({ updated: 0, note: "No fields to update" }, { status: 200 });
    }

    // WHERE clause
    let where = `WHERE "organizationId" = $${i++}`;
    vals.push(organizationId);

    if (!all) {
      if (clientIds?.length) {
        where += ` AND id = ANY($${i++})`;
        vals.push(clientIds);
      }
      if (userIds?.length) {
        where += ` AND "userId" = ANY($${i++})`;
        vals.push(userIds);
      }
    }

    const sql = `
      UPDATE public.clients
         SET ${sets.join(", ")},
             "updatedAt" = NOW()
       ${where}
      RETURNING id
    `;
    const { rowCount } = await pool.query(sql, vals);

    return NextResponse.json({ updated: rowCount ?? 0 }, { status: 200 });
  } catch (err: any) {
    console.error("[PATCH /api/clients/secret-phrase/settings] error:", err);
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.errors }, { status: 400 });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/* Optional: GET to preview counts/targets quickly */
export async function GET(req: NextRequest) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { organizationId } = ctx;

  try {
    const sql = `
      SELECT
        COUNT(*) FILTER (WHERE "secretPhraseEnabled")  AS enabled_count,
        COUNT(*) FILTER (WHERE NOT "secretPhraseEnabled") AS disabled_count,
        MIN("secretPhraseReverifyDays") AS min_days,
        MAX("secretPhraseReverifyDays") AS max_days
      FROM public.clients
      WHERE "organizationId" = $1
    `;
    const { rows } = await pool.query(sql, [organizationId]);
    return NextResponse.json(rows[0] || {}, { status: 200 });
  } catch (err) {
    console.error("[GET /api/clients/secret-phrase/settings] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
