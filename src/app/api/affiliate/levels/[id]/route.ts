// src/app/api/affiliate/levels/[id]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Pool } from "pg";
import { getContext } from "@/lib/context";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET as string;

/* schema reused from parent */
const levelSchema = z.object({
  name: z.string().min(1).optional(),
  levelUpMessage: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  requiredPoints: z.number().int().nonnegative().optional(),
});

async function orgId(req: NextRequest): Promise<string | NextResponse> {
  const apiKey = req.headers.get("x-api-key");
  const secret = req.headers.get("x-internal-secret");
  const explicit = new URL(req.url).searchParams.get("organizationId");
  if (apiKey) {
    const { valid, error } = await auth.api.verifyApiKey({ body: { key: apiKey } });
    if (!valid) return NextResponse.json({ error: error?.message }, { status: 401 });
    return explicit ?? NextResponse.json({ error: "organizationId required" }, { status: 400 });
  }
  if (secret === INTERNAL_API_SECRET) {
    const s = await auth.api.getSession({ headers: req.headers });
    if (!s) return NextResponse.json({ error: "Unauthorized session" }, { status: 401 });
    return explicit || s.session.activeOrganizationId;
  }
  return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
}

/* GET single */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { organizationId } = ctx;
  const { rows } = await pool.query(
    `SELECT * FROM "affiliateLevels" WHERE id = $1 AND "organizationId" = $2`,
    [params.id, organizationId],
  );
  return rows.length
    ? NextResponse.json(rows[0])
    : NextResponse.json({ error: "Not found" }, { status: 404 });
}
/* PATCH update */
export async function PATCH(
  req: NextRequest,
  context: { params: { id: string } }
) {
  // pull in auth + org
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { organizationId } = ctx;

  // await your params
  const { id } = await context.params;

  try {
    const vals = levelSchema.parse(await req.json());
    if (Object.keys(vals).length === 0)
      return NextResponse.json({ error: "No fields" }, { status: 400 });

    // build SET clauses
    const set: string[] = [];
    const v: any[] = [];
    let i = 1;
    for (const [k, val] of Object.entries(vals)) {
      set.push(`"${k}" = $${i++}`);
      v.push(val);
    }

    // push the awaited id and the real organizationId
    v.push(id, organizationId);

    const { rows } = await pool.query(
      `
      UPDATE "affiliateLevels"
      SET ${set.join(", ")}, "updatedAt" = NOW()
      WHERE id = $${i++} AND "organizationId" = $${i}
      RETURNING *
      `,
      v
    );

    return rows.length
      ? NextResponse.json(rows[0])
      : NextResponse.json({ error: "Not found" }, { status: 404 });
  } catch (e: any) {
    if (e instanceof z.ZodError)
      return NextResponse.json({ error: e.errors }, { status: 400 });
    console.error(e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/* DELETE */
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { organizationId } = ctx;
  const { rows } = await pool.query(
    `DELETE FROM "affiliateLevels" WHERE id = $1 AND "organizationId" = $2 RETURNING *`,
    [params.id, organizationId],
  );
  return rows.length
    ? NextResponse.json({ message: "Deleted" })
    : NextResponse.json({ error: "Not found" }, { status: 404 });
}