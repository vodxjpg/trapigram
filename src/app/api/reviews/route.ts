// File: src/app/api/reviews/route.ts
import { NextRequest, NextResponse } from "next/server";
import { Pool } from "pg";
import { auth } from "@/lib/auth";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});
const INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET as string;

export async function GET(req: NextRequest) {
  const apiKey = req.headers.get("x-api-key");
  const internalSecret = req.headers.get("x-internal-secret");
  let organizationId: string;

  // Try session first
  const session = await auth.api.getSession({ headers: req.headers });
  if (session) {
    organizationId = session.session.activeOrganizationId;
    if (!organizationId) {
      return NextResponse.json(
        { error: "No active organization in session" },
        { status: 400 }
      );
    }
  }
  // Then API key
  else if (apiKey) {
    const { valid, error, key } = await auth.api.verifyApiKey({
      body: { key: apiKey },
    });
    if (!valid || !key) {
      return NextResponse.json(
        { error: error?.message || "Invalid API key" },
        { status: 401 }
      );
    }
    organizationId = key.userId; // or however you derive it from the key
  }
  // Then internal secret
  else if (internalSecret === INTERNAL_API_SECRET) {
    const internalSession = await auth.api.getSession({ headers: req.headers });
    if (!internalSession) {
      return NextResponse.json(
        { error: "Unauthorized session" },
        { status: 401 }
      );
    }
    organizationId = internalSession.session.activeOrganizationId;
  }
  // Otherwise forbid
  else {
    return NextResponse.json(
      { error: "Unauthorized: Provide valid session, API key, or internal secret" },
      { status: 403 }
    );
  }

  try {
    const result = await pool.query(
      `
      SELECT 
        id,
        "orderId",
        text,
        rate,
        "createdAt",
        "updatedAt"
      FROM reviews
      WHERE "organizationId" = $1
      ORDER BY "createdAt" DESC
      `,
      [organizationId]
    );

    return NextResponse.json({ reviews: result.rows }, { status: 200 });
  } catch (err) {
    console.error("[GET /api/reviews] error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
