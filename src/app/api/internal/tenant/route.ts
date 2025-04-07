// /src/app/api/internal/tenant/route.ts
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { pool } from "@/lib/db";

const INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET || "your-secret-here";

export async function POST(req: NextRequest) {
  try {
    // Verify the internal secret
    const secret = req.headers.get("x-internal-secret");
    if (secret !== INTERNAL_API_SECRET) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    // Get the user session
    const session = await auth.api.getSession({ headers: req.headers });
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const user = session.user;
    const body = await req.json();
    const { plan } = body; // Optional, included from your original code

    // Check if a tenant already exists for this user
    const { rows: existingTenants } = await pool.query(
      `SELECT id FROM tenant WHERE "ownerUserId" = $1`,
      [user.id]
    );

    if (existingTenants.length > 0) {
      return NextResponse.json({ error: "Tenant already exists" }, { status: 400 });
    }

    // Insert the new tenant with owner_name and owner_email
    const { rows: newTenant } = await pool.query(
      `INSERT INTO tenant (id, "ownerUserId", owner_name, owner_email, "createdAt", "updatedAt", "onboardingCompleted")
       VALUES (gen_random_uuid()::text, $1, $2, $3, NOW(), NOW(), 0)
       RETURNING id, "ownerUserId", owner_name, owner_email, "createdAt", "updatedAt", "onboardingCompleted"`,
      [user.id, user.name, user.email]
    );

    // Return the created tenant
    return NextResponse.json({ tenant: newTenant[0] }, { status: 201 });
  } catch (error) {
    console.error("Error creating tenant:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}