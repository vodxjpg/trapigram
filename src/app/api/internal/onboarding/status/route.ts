import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { authClient } from "@/lib/auth-client";
import { Pool } from "pg";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

const INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET as string;

export async function GET(req: NextRequest) {
  try {
    const secret = req.headers.get("x-internal-secret");
    if (secret !== INTERNAL_API_SECRET) {
      return NextResponse.json({ error: "Unauthorized22" }, { status: 403 });
    }

    const session = await auth.api.getSession({ headers: req.headers });
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const user = session.user;

    const { data: organizations } = await authClient.organization.list();
    const ownedOrganizations = organizations ? organizations.filter((org: any) => org.role === "owner") : [];
    if (ownedOrganizations.length === 0) {
      return NextResponse.json({ currentStep: 1 }, { status: 200 });
    }
    const organization = ownedOrganizations[0];

    const { rows: warehouses } = await pool.query(
      `SELECT id FROM warehouse WHERE "organizationId" = $1`,
      [organization.id]
    );
    if (warehouses.length === 0) {
      return NextResponse.json({ currentStep: 2 }, { status: 200 });
    }

    const { rows: platformKeys } = await pool.query(
      `SELECT id FROM platform_keys WHERE "organizationId" = $1`,
      [organization.id]
    );
    if (platformKeys.length === 0) {
      return NextResponse.json({ currentStep: 3 }, { status: 200 });
    }

    const { rows: supportEmails } = await pool.query(
      `SELECT id FROM support_emails WHERE "organizationId" = $1`,
      [organization.id]
    );
    if (supportEmails.length === 0) {
      return NextResponse.json({ currentStep: 4 }, { status: 200 });
    }

    const { rows: orgWithSecret } = await pool.query(
      `SELECT "encryptedSecret" FROM organization WHERE id = $1 AND "encryptedSecret" IS NOT NULL`,
      [organization.id]
    );
    if (orgWithSecret.length === 0 || !orgWithSecret[0].encryptedSecret) {
      return NextResponse.json({ currentStep: 5 }, { status: 200 });
    }

    // If all steps are complete, set onboardingCompleted to -1
    const { rows: tenants } = await pool.query(
      `SELECT "onboardingCompleted" FROM tenant WHERE "ownerUserId" = $1`,
      [user.id]
    );
    const tenant = tenants[0];
    if (tenant && tenant.onboardingCompleted !== -1) {
      await pool.query(
        `UPDATE tenant SET "onboardingCompleted" = $1, "updatedAt" = NOW() WHERE "ownerUserId" = $2`,
        [-1, user.id]
      );
    }

    return NextResponse.json({ currentStep: 6 }, { status: 200 });
  } catch (error) {
    console.error("Error checking onboarding status:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}