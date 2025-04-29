import { NextRequest, NextResponse } from "next/server";
import { Pool } from "pg";
import { v4 as uuidv4 } from "uuid";
import { auth } from "@/lib/auth";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET as string;

/* helper – make a unique CODE within an org */
async function uniqueCode(base: string, organizationId: string): Promise<string> {
  let candidate = `${base}-COPY`;
  let i = 1;
  while (true) {
    const { rows } = await pool.query(
      `SELECT 1 FROM coupons WHERE code = $1 AND "organizationId" = $2 LIMIT 1`,
      [candidate, organizationId],
    );
    if (rows.length === 0) return candidate;
    candidate = `${base}-COPY-${i++}`;
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  /* ---------- auth (same rules as POST /api/coupons) ----------- */
  const apiKey = req.headers.get("x-api-key");
  const internalSecret = req.headers.get("x-internal-secret");
  let organizationId: string;

  const { searchParams } = new URL(req.url);
  const explicitOrgId = searchParams.get("organizationId");

  const session = await auth.api.getSession({ headers: req.headers });
  if (session) {
    organizationId = explicitOrgId || session.session.activeOrganizationId;
    if (!organizationId)
      return NextResponse.json({ error: "No active organization in session" }, { status: 400 });
  } else if (apiKey) {
    const { valid, error, key } = await auth.api.verifyApiKey({ body: { key: apiKey } });
    if (!valid || !key)
      return NextResponse.json({ error: error?.message || "Invalid API key" }, { status: 401 });
    organizationId = explicitOrgId || "";
    if (!organizationId)
      return NextResponse.json(
        { error: "Organization ID is required in query parameters" },
        { status: 400 },
      );
  } else if (internalSecret === INTERNAL_API_SECRET) {
    const s = await auth.api.getSession({ headers: req.headers });
    if (!s)
      return NextResponse.json({ error: "Unauthorized session" }, { status: 401 });
    organizationId = explicitOrgId || s.session.activeOrganizationId;
    if (!organizationId)
      return NextResponse.json({ error: "No active organization in session" }, { status: 400 });
  } else {
    return NextResponse.json(
      { error: "Unauthorized: Provide a valid session, API key, or internal secret" },
      { status: 403 },
    );
  }

  try {
    const { id: sourceId } = await params;

    /* ---------- fetch source coupon ---------------------------- */
    const { rows } = await pool.query(
      `SELECT * FROM coupons WHERE id = $1 AND "organizationId" = $2`,
      [sourceId, organizationId],
    );
    if (rows.length === 0)
      return NextResponse.json({ error: "Coupon not found" }, { status: 404 });
    const c = rows[0];

    /* ---------- build duplicate -------------------------------- */
    const newId = uuidv4();
    const newCode = await uniqueCode(c.code, organizationId);

    const insert = `
      INSERT INTO coupons(
        id, "organizationId", name, code, description,
        "discountType", "discountAmount", "expirationDate",
        "limitPerUser", "usageLimit", "expendingLimit", "expendingMinimum",
        countries, visibility, "createdAt", "updatedAt"
      )
      VALUES(
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,NOW(),NOW()
      )
      RETURNING *
    `;
    const vals = [
      newId,
      organizationId,
      c.name,
      newCode,
      c.description,
      c.discountType,
      c.discountAmount,
      c.expirationDate,
      c.limitPerUser,
      c.usageLimit,
      c.expendingLimit,
      c.expendingMinimum,
      c.countries,
      c.visibility,
    ];

    const { rows: newRows } = await pool.query(insert, vals);
    const dup = newRows[0];
    dup.countries = JSON.parse(dup.countries);

    return NextResponse.json(dup, { status: 201 });
  } catch (err) {
    console.error("[COUPON_DUPLICATE]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
