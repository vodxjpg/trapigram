import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { pgPool as pool } from "@/lib/db";
import { getContext } from "@/lib/context";

type Params = { params: Promise<{ id: string }> }; // id = Telegram userId

const patchSchema = z.object({
  enabled: z.boolean().optional(),
  reverifyAfterDays: z.number().int().min(1).max(365).optional(),
  forceAt: z.string().datetime().optional(),  // ISO 8601
  forceNow: z.boolean().optional(),           // convenience
});

async function findClientRow(userId: string, organizationId: string) {
  const sql = `
    SELECT id,
           "secretPhraseEnabled",
           "secretPhraseReverifyDays",
           "secretPhraseForceAt"
      FROM public.clients
     WHERE "userId" = $1 AND "organizationId" = $2
     LIMIT 1
  `;
  const { rows } = await pool.query(sql, [userId, organizationId]);
  return rows[0] || null;
}

/* GET one client settings */
export async function GET(req: NextRequest, { params }: Params) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { organizationId } = ctx;
  const { id: userId } = await params;

  try {
    const c = await findClientRow(userId, organizationId);
    if (!c) return NextResponse.json({ error: "Client not found" }, { status: 404 });

    return NextResponse.json({
      enabled: c.secretPhraseEnabled,
      reverifyAfterDays: c.secretPhraseReverifyDays,
      forceAt: c.secretPhraseForceAt,
    });
  } catch (err) {
    console.error("[GET /api/clients/secret-phrase/[id]/settings] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/* PATCH one client settings */
export async function PATCH(req: NextRequest, { params }: Params) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { organizationId } = ctx;
  const { id: userId } = await params;

  try {
    const body = patchSchema.parse(await req.json());
    const current = await findClientRow(userId, organizationId);
    if (!current) return NextResponse.json({ error: "Client not found" }, { status: 404 });

    const nextEnabled = body.enabled ?? current.secretPhraseEnabled;
    const nextDays = body.reverifyAfterDays ?? current.secretPhraseReverifyDays;
    const nextForceAt = body.forceNow
      ? new Date()
      : (body.forceAt ? new Date(body.forceAt) : current.secretPhraseForceAt);

    const updSql = `
      UPDATE public.clients
         SET "secretPhraseEnabled"      = $1,
             "secretPhraseReverifyDays" = $2,
             "secretPhraseForceAt"      = $3,
             "updatedAt"                = NOW()
       WHERE id = $4
       RETURNING
         "secretPhraseEnabled"      AS enabled,
         "secretPhraseReverifyDays" AS "reverifyAfterDays",
         "secretPhraseForceAt"      AS "forceAt"
    `;
    const { rows } = await pool.query(updSql, [
      nextEnabled,
      nextDays,
      nextForceAt,
      current.id,
    ]);

    return NextResponse.json(rows[0]);
  } catch (err: any) {
    console.error("[PATCH /api/clients/secret-phrase/[id]/settings] error:", err);
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.errors }, { status: 400 });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
