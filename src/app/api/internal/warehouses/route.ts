// src/app/api/internal/warehouses/route.ts
import { NextRequest, NextResponse } from "next/server";
import { pgPool as pool } from "@/lib/db";
import { auth } from "@/lib/auth";

const INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET as string;

export async function POST(req: NextRequest) {
  try {
    /* 🔐 simple internal-secret check */
    if (req.headers.get("x-internal-secret") !== INTERNAL_API_SECRET) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    /* 🙋 user session */
    const session = await auth.api.getSession({ headers: req.headers });
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const userId = session.user.id;

    /* 📋 body */
    const { organizationIds, warehouseName, countries } = (await req.json()) as {
      organizationIds: string[];
      warehouseName:   string;
      countries:       string[];
    };

    if (!organizationIds?.length)
      return NextResponse.json({ error: "At least one organizationId is required" }, { status: 400 });
    if (!warehouseName)
      return NextResponse.json({ error: "warehouseName is required" }, { status: 400 });
    if (!countries?.length)
      return NextResponse.json({ error: "At least one country is required" }, { status: 400 });

    /* 🔎  resolve tenant that belongs to this user */
    const { rows: [t] } = await pool.query<{ id: string }>(
      `SELECT id FROM tenant WHERE "ownerUserId" = $1 LIMIT 1`,
      [userId],
    );
    if (!t)
      return NextResponse.json({ error: "Tenant not found for user" }, { status: 404 });

    /* 🏗️  insert warehouse */
    const { rows: [wh] } = await pool.query(
      `INSERT INTO warehouse
         (id, "tenantId", "organizationId", name, countries, "createdAt", "updatedAt")
       VALUES (gen_random_uuid()::text, $1, $2, $3, $4::jsonb, NOW(), NOW())
       RETURNING id, "tenantId", "organizationId", name, countries`,
      [t.id, organizationIds.join(","), warehouseName, JSON.stringify(countries)],
    );

    return NextResponse.json({ warehouse: wh }, { status: 201 });
  } catch (err) {
    console.error("[POST /api/internal/warehouses]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
