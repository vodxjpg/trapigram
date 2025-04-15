import { NextRequest, NextResponse } from "next/server";
import { Pool } from "pg";
import { auth } from "@/lib/auth";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});
const INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET as string;

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  // Retrieve API key and internal secret from headers.
  const apiKey = req.headers.get("x-api-key");
  const internalSecret = req.headers.get("x-internal-secret");
  let organizationId: string;

  const { searchParams } = new URL(req.url);
  const explicitOrgId = searchParams.get("organizationId");

  // Verify the request using API key or internal secret.
  if (apiKey) {
    const { valid, error, key } = await auth.api.verifyApiKey({
      body: { key: apiKey },
    });
    if (!valid || !key) {
      return NextResponse.json(
        { error: error?.message || "Invalid API key" },
        { status: 401 }
      );
    }
    const session = await auth.api.getSession({ headers: req.headers });
    organizationId = session?.session.activeOrganizationId || "";
    if (!organizationId) {
      return NextResponse.json(
        { error: "Organization ID is required" },
        { status: 400 }
      );
    }
  } else if (internalSecret === INTERNAL_API_SECRET) {
    const session = await auth.api.getSession({ headers: req.headers });
    if (!session) {
      return NextResponse.json(
        { error: "Unauthorized session" },
        { status: 401 }
      );
    }
    organizationId = explicitOrgId || session.session.activeOrganizationId;
    if (!organizationId) {
      return NextResponse.json(
        { error: "No active organization in session" },
        { status: 400 }
      );
    }
  } else {
    return NextResponse.json(
      { error: "Unauthorized: Provide either an API key or internal secret" },
      { status: 403 }
    );
  }

  try {
    const { id } = params;

    // We create a query to update the 'sent' flag and update the 'updatedAt' field.
    const query = `
      UPDATE announcements
      SET "sent" = true,
          "updatedAt" = NOW()
      WHERE id = $1 AND "organizationId" = $2
      RETURNING *
    `;
    const values = [id, organizationId];

    const result = await pool.query(query, values);
    if (result.rows.length === 0) {
      return NextResponse.json(
        { error: "Announcement not found" },
        { status: 404 }
      );
    }
    return NextResponse.json(result.rows[0]);
  } catch (error: any) {
    console.error("[PATCH /api/announcements/send/[id]] error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
