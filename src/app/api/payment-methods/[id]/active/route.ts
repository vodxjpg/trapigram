// src/app/api/payment-methods/[id]/route.ts

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Pool } from "pg";
import { auth } from "@/lib/auth";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

const INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET as string;

// ---------------------- Zod schemas ----------------------
const paymentUpdateSchema = z.object({
  active: z.boolean(),
});

type Params = { params: { id: string } };

export async function PATCH(req: NextRequest, { params }: Params) {
  // --- same auth boilerplate as above ---
  const apiKey = req.headers.get("x-api-key");
  const internalSecret = req.headers.get("x-internal-secret");
  let organizationId: string;

  const { searchParams } = new URL(req.url);
  const explicitOrgId = searchParams.get("organizationId");

  const session = await auth.api.getSession({ headers: req.headers });
  if (session) {
    organizationId = explicitOrgId || session.session.activeOrganizationId!;
    if (!organizationId) {
      return NextResponse.json({ error: "No active organization in session" }, { status: 400 });
    }
  } else if (apiKey) {
    const { valid, error, key } = await auth.api.verifyApiKey({ body: { key: apiKey } });
    if (!valid || !key) {
      return NextResponse.json({ error: error?.message || "Invalid API key" }, { status: 401 });
    }
    organizationId = explicitOrgId || "";
    if (!organizationId) {
      return NextResponse.json({ error: "Organization ID required" }, { status: 400 });
    }
  } else if (internalSecret === INTERNAL_API_SECRET) {
    const internalSession = await auth.api.getSession({ headers: req.headers });
    if (!internalSession) {
      return NextResponse.json({ error: "Unauthorized session" }, { status: 401 });
    }
    organizationId = explicitOrgId || internalSession.session.activeOrganizationId!;
    if (!organizationId) {
      return NextResponse.json({ error: "No active organization in session" }, { status: 400 });
    }
  } else {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  try { 
    const { id } = await params;
    const { active } = await req.json();
    
    const sql = `
      UPDATE "paymentMethods"
      SET active = $1, "updatedAt" = NOW()
      WHERE id = $2
      RETURNING *
    `;

    const values = [
        active,
        id
    ]    
    const res = await pool.query(sql, values);
    if (!res.rows.length) {
      return NextResponse.json({ error: "Payment method not found" }, { status: 404 });
    }
    return NextResponse.json(res.rows[0]);
  } catch (err: any) {
    console.error("[PATCH /api/payment-methods/[id]]", err);
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.errors }, { status: 400 });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
