// /src/app/api/tickets/route.ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Pool } from "pg";
import { auth } from "@/lib/auth";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET as string;

/* -------------------------------------------------------------------------- */
/* 1. Zod schema                                                              */
/* -------------------------------------------------------------------------- */
const tagSchema = z.object({
  id: z.string(),
  description: z.string(),
});

/* -------------------------------------------------------------------------- */
/* 2. GET  /api/tags                                                       */
/* -------------------------------------------------------------------------- */
export async function GET(req: NextRequest) {
  /* --- 2.1  Auth logic (same pattern you use for coupons) ---------------- */
  const apiKey = req.headers.get("x-api-key");
  const internalSecret = req.headers.get("x-internal-secret");
  const { searchParams } = new URL(req.url);

  const explicitOrgId = searchParams.get("organizationId");
  let organizationId: string;

  const session = await auth.api.getSession({ headers: req.headers });
  if (session) {
    organizationId = explicitOrgId || session.session.activeOrganizationId;
    if (!organizationId)
      return NextResponse.json({ error: "No active organization in session" }, { status: 400 });
  } else if (apiKey) {
    const { valid, error } = await auth.api.verifyApiKey({ body: { key: apiKey } });
    if (!valid) return NextResponse.json({ error: error?.message || "Invalid API key" }, { status: 401 });
    organizationId = explicitOrgId || "";
    if (!organizationId)
      return NextResponse.json({ error: "organizationId is required" }, { status: 400 });
  } else if (internalSecret === INTERNAL_API_SECRET) {
    const s = await auth.api.getSession({ headers: req.headers });
    if (!s) return NextResponse.json({ error: "Unauthorized session" }, { status: 401 });
    organizationId = explicitOrgId || s.session.activeOrganizationId;
    if (!organizationId)
      return NextResponse.json({ error: "No active organization in session" }, { status: 400 });
  } else {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const query = `
    SELECT id, "description"
    FROM tags
  `;

  try {

    const tags = (await pool.query(query)).rows
    console.log(tags)

    return NextResponse.json({ tags });
  } catch (err) {
    console.error("[GET /api/tags]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}