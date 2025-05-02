import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Pool } from "pg";
import { auth } from "@/lib/auth";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET as string;

const logUpdateSchema = z.object({
  points: z.number().int().optional(),
  action: z.string().optional(),
  description: z.string().optional().nullable(),
});

async function resolveOrgId(req: NextRequest) {
  const apiKey = req.headers.get("x-api-key");
  const internalSecret = req.headers.get("x-internal-secret");
  const explicitOrgId = new URL(req.url).searchParams.get("organizationId");

  if (apiKey) {
    const { valid, error } = await auth.api.verifyApiKey({ body: { key: apiKey } });
    if (!valid)
      return NextResponse.json({ error: error?.message || "Invalid API key" }, { status: 401 });
    if (!explicitOrgId)
      return NextResponse.json({ error: "organizationId query param required" }, { status: 400 });
    return explicitOrgId;
  }

  if (internalSecret === INTERNAL_API_SECRET) {
    const session = await auth.api.getSession({ headers: req.headers });
    if (!session)
      return NextResponse.json({ error: "Unauthorized session" }, { status: 401 });
    return explicitOrgId || session.session.activeOrganizationId;
  }

  return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
}

/* GET */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const orgId = await resolveOrgId(req);
  if (orgId instanceof NextResponse) return orgId;
  try {
    const { rows } = await pool.query(
      `SELECT * FROM "affiliatePointLogs" WHERE id = $1 AND "organizationId" = $2`,
      [params.id, orgId],
    );
    if (rows.length === 0)
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(rows[0]);
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/* PATCH */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const orgId = await resolveOrgId(req);
  if (orgId instanceof NextResponse) return orgId;

  try {
    const parsed = logUpdateSchema.parse(await req.json());
    if (Object.keys(parsed).length === 0)
      return NextResponse.json({ error: "No fields provided" }, { status: 400 });

    const sets: string[] = [];
    const vals: any[] = [];
    let i = 1;
    for (const [k, v] of Object.entries(parsed)) {
      if (v !== undefined) {
        sets.push(`"${k}" = $${i++}`);
        vals.push(v);
      }
    }
    vals.push(params.id, orgId);
    const { rows } = await pool.query(
      `
      UPDATE "affiliatePointLogs"
      SET ${sets.join(", ")},"updatedAt" = NOW()
      WHERE id = $${i++} AND "organizationId" = $${i}
      RETURNING *
      `,
      vals,
    );
    if (rows.length === 0)
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(rows[0]);
  } catch (e: any) {
    console.error(e);
    if (e instanceof z.ZodError)
      return NextResponse.json({ error: e.errors }, { status: 400 });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/* DELETE */
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const orgId = await resolveOrgId(req);
  if (orgId instanceof NextResponse) return orgId;

  try {
    const { rows } = await pool.query(
      `DELETE FROM "affiliatePointLogs" WHERE id = $1 AND "organizationId" = $2 RETURNING *`,
      [params.id, orgId],
    );
    if (rows.length === 0)
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ message: "Deleted" });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
