// /src/app/api/affiliate/levels/assign/route.ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Pool } from "pg";
import { auth } from "@/lib/auth";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET as string;

/*──────── request body ────────*/
const bodySchema = z.object({
  clientId: z.string().min(1, "clientId required"),
});

/*──────── org‑resolver helper (same pattern) ────────*/
async function resolveOrgId(
  req: NextRequest,
): Promise<string | NextResponse> {
  const apiKey = req.headers.get("x-api-key");
  const secret = req.headers.get("x-internal-secret");
  const explicit = new URL(req.url).searchParams.get("organizationId");

  if (apiKey) {
    const { valid, error } = await auth.api.verifyApiKey({ body: { key: apiKey } });
    if (!valid)
      return NextResponse.json({ error: error?.message }, { status: 401 });
    return explicit ?? NextResponse.json(
      { error: "organizationId required" },
      { status: 400 },
    );
  }

  if (secret === INTERNAL_API_SECRET) {
    const session = await auth.api.getSession({ headers: req.headers });
    if (!session)
      return NextResponse.json({ error: "Unauthorized session" }, { status: 401 });
    return explicit || session.session.activeOrganizationId;
  }

  return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
}

/*──────── POST /api/affiliate/levels/assign ────────*/
export async function POST(req: NextRequest) {
  /* 1️⃣ Auth & org ID */
  const orgId = await resolveOrgId(req);
  if (orgId instanceof NextResponse) return orgId;

  /* 2️⃣ Validate body */
  let body;
  try {
    body = bodySchema.parse(await req.json());
  } catch (e: any) {
    if (e instanceof z.ZodError)
      return NextResponse.json({ error: e.errors }, { status: 400 });
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { clientId } = body;

  try {
    /* 3️⃣ Current balance */
    const {
      rows: [{ sum }],
    } = await pool.query(
      `SELECT COALESCE(SUM(points),0) FROM "affiliatePointLogs"
       WHERE "organizationId" = $1 AND "clientId" = $2`,
      [orgId, clientId],
    );
    const balance = Number(sum);

    /* 4️⃣ Pick best level */
    const levelRes = await pool.query(
      `SELECT * FROM "affiliateLevels"
       WHERE "organizationId" = $1 AND "requiredPoints" <= $2
       ORDER BY "requiredPoints" DESC LIMIT 1`,
      [orgId, balance],
    );
    const level = levelRes.rows[0] ?? null;
    const levelId = level ? level.id : null;

    /* 5️⃣ Update client */
    const { rows } = await pool.query(
      `UPDATE clients
       SET "levelId" = $1, "updatedAt" = NOW()
       WHERE id = $2 AND "organizationId" = $3
       RETURNING *`,
      [levelId, clientId, orgId],
    );
    if (rows.length === 0)
      return NextResponse.json({ error: "Client not found" }, { status: 404 });

    return NextResponse.json({
      client: rows[0],
      assignedLevel: level,
      balance,
    });
  } catch (e) {
    console.error("[POST /api/affiliate/levels/assign] error:", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
