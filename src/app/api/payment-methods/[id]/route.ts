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
  name: z.string().min(1, { message: "Name is required." }),
  active: z.boolean(),
  apiKey: z.string().nullable().optional(),
  secretKey: z.string().nullable().optional()
});

type Params = { params: { id: string } };

// ---------------------- GET /api/payment-methods/[id] ----------------------
export async function GET(req: NextRequest, { params }: Params) {
  // --- auth (mirrors coupons logic) ---
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
    const { id } = params;
    const sql = `
      SELECT id, "tenantId", name, active, "apiKey", "secretKey", "createdAt", "updatedAt"
      FROM "paymentMethods"
      WHERE id = $1
    `;
    const result = await pool.query(sql, [id]);    
    if (result.rows.length === 0) {
      return NextResponse.json({ error: "Payment method not found" }, { status: 404 });
    }
    return NextResponse.json(result.rows[0]);
  } catch (err: any) {
    console.error("[GET /api/payment-methods/[id]]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// ---------------------- PATCH /api/payment-methods/[id] ----------------------
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
    const { id } = params;
    const body = await req.json();
    const parsed = paymentUpdateSchema.parse(body);

    // build dynamic update
    const updates: string[] = [];
    const values: any[]    = [];
    let idx = 1;
    

    for (const [key, val] of Object.entries(parsed)) {
      updates.push(`"${key}" = $${idx++}`);
      values.push(val);
    }
    if (!updates.length) {
      return NextResponse.json({ error: "No fields to update" }, { status: 400 });
    }

    values.push(id);
    
    const sql = `
      UPDATE "paymentMethods"
      SET ${updates.join(", ")}, "updatedAt" = NOW()
      WHERE id = $${idx++}
      RETURNING *
    `;
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

// ---------------------- DELETE /api/payment-methods/[id] ----------------------
export async function DELETE(req: NextRequest, { params }: Params) {
  // --- same auth as above ---
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
    const { id } = params;
    const sql = `
      DELETE FROM "paymentMethods"
      WHERE id = $1
      RETURNING *
    `;
    const res = await pool.query(sql, [id]);
    if (!res.rows.length) {
      return NextResponse.json({ error: "Payment method not found" }, { status: 404 });
    }
    return NextResponse.json({ message: "Payment method deleted" });
  } catch (err: any) {
    console.error("[DELETE /api/payment-methods/[id]]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
