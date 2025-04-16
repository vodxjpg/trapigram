// File: src/app/api/organizations/countries/route.ts

import { NextRequest, NextResponse } from "next/server";
import { Pool } from "pg";
import { auth } from "@/lib/auth";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});
const INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET as string;

export async function GET(req: NextRequest) {
  try {
    const apiKey = req.headers.get("x-api-key");
    const internalSecret = req.headers.get("x-internal-secret");
    let organizationId: string | undefined;

    // Prefer session: get session and extract the active organization ID.
    const session = await auth.api.getSession({ headers: req.headers });
    if (session && session.session && session.session.activeOrganizationId) {
      organizationId = session.session.activeOrganizationId;
    }
    // Alternatively, if an API key is provided.
    else if (apiKey) {
      const { valid, error, key } = await auth.api.verifyApiKey({ body: { key: apiKey } });
      if (!valid || !key) {
        return NextResponse.json({ error: error?.message || "Invalid API key" }, { status: 401 });
      }
      // You could set organizationId from the API key object if available.
      // For example, if your API key object contains organizationId:
      organizationId = key.organizationId;
    }
    // Alternatively, check the internal secret.
    else if (internalSecret === INTERNAL_API_SECRET) {
      const internalSession = await auth.api.getSession({ headers: req.headers });
      if (!internalSession || !internalSession.session || !internalSession.session.activeOrganizationId) {
        return NextResponse.json({ error: "Unauthorized session" }, { status: 401 });
      }
      organizationId = internalSession.session.activeOrganizationId;
    } else {
      return NextResponse.json(
        { error: "Unauthorized: Provide a valid session, API key, or internal secret" },
        { status: 403 }
      );
    }

    if (!organizationId) {
      return NextResponse.json({ error: "No active organization found in the session" }, { status: 400 });
    }

    // Query the organization table for the countries using the organizationId.
    const query = `
      SELECT countries
      FROM organization
      WHERE id = $1
    `;
    const result = await pool.query(query, [organizationId]);

    if (result.rows.length === 0) {
      return NextResponse.json({ error: "Organization not found" }, { status: 404 });
    }

    const countriesData = result.rows[0].countries;
    return NextResponse.json({ countries: countriesData }, { status: 200 });
  } catch (error: any) {
    console.error("[GET /api/organizations/countries] error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
