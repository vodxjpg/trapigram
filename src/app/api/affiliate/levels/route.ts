import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Pool } from "pg";
import { getContext } from "@/lib/context";
import { v4 as uuidv4 } from "uuid";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET as string;

/* fixed: no .url() */
const levelSchema = z.object({
  name: z.string().min(1),
  image: z.string().optional().nullable(),
  levelUpMessage: z.string().optional().nullable(),
  description: z.string().optional().nullable(),
  requiredPoints: z.number().int().nonnegative(),
});

/* ── resolve org helper unchanged ── */
async function orgId(req: NextRequest): Promise<string | NextResponse> {
  const apiKey  = req.headers.get("x-api-key");
  const secret  = req.headers.get("x-internal-secret");
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
  };
  /* 3️⃣ 💡  Dashboard/browser calls – new */
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!session.session.activeOrganizationId)
    return NextResponse.json({ error: "No active organization" }, { status: 400 });

  return explicit || session.session.activeOrganizationId;
}


/* GET list */
export async function GET(req: NextRequest) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { organizationId } = ctx;

  const { rows } = await pool.query(
    `SELECT * FROM "affiliateLevels" WHERE "organizationId" = $1 ORDER BY "requiredPoints"`,
    [organizationId],
  );
  return NextResponse.json({ levels: rows });
}

/* POST create */
export async function POST(req: NextRequest) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { organizationId } = ctx;
  try {
    const vals = levelSchema.parse(await req.json());
    const id = uuidv4();
    const { rows } = await pool.query(
      `
      INSERT INTO "affiliateLevels"(
        id,"organizationId",name,image,"levelUpMessage",description,"requiredPoints",
        "createdAt","updatedAt"
      ) VALUES($1,$2,$3,$4,$5,$6,$7,NOW(),NOW()) RETURNING *`,
      [
        id,
        organizationId,
        vals.name,
        vals.image ?? null,
        vals.levelUpMessage ?? null,
        vals.description ?? null,
        vals.requiredPoints,
      ],
    );
    return NextResponse.json(rows[0], { status: 201 });
  } catch (e: any) {
    if (e instanceof z.ZodError) return NextResponse.json({ error: e.errors }, { status: 400 });
    console.error(e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
