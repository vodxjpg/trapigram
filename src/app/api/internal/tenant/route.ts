// /home/zodx/Desktop/trapigram/src/app/api/internal/tenant/route.ts
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { Pool } from "pg";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

const INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET || "your-secret-here";

export async function POST(req: NextRequest) {
  try {
    const secret = req.headers.get("x-internal-secret");
    if (secret !== INTERNAL_API_SECRET) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    const session = await auth.api.getSession({ headers: req.headers });
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const user = session.user;
    const body = await req.json();
    const { plan } = body; // Optional

    const { rows: existingTenants } = await pool.query(
      `SELECT id FROM tenant WHERE "ownerUserId" = $1`,
      [user.id]
    );

    if (existingTenants.length > 0) {
      return NextResponse.json({ error: "Tenant already exists" }, { status: 400 });
    }

    const { rows: newTenant } = await pool.query(
      `INSERT INTO tenant (id, "ownerUserId", "createdAt", "updatedAt", "onboardingCompleted")
       VALUES (gen_random_uuid()::text, $1, NOW(), NOW(), 0)
       RETURNING id, "ownerUserId", "createdAt", "updatedAt", "onboardingCompleted"`,
      [user.id]
    );

    return NextResponse.json({ tenant: newTenant[0] }, { status: 201 });
  } catch (error) {
    console.error("Error creating tenant:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}