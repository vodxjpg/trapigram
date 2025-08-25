export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { pgPool as pool } from "@/lib/db";
import { getContext } from "@/lib/context";

// NOTE: No cooldown here. Verification should never be throttled by time;
// only validity/expiry of code matters.

export async function POST(req: NextRequest) {
  try {
    const ctx = await getContext(req);
    if (ctx instanceof NextResponse) return ctx;
    const { userId, organizationId } = ctx;

    if (!userId || !organizationId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { code } = (await req.json()) as { code?: string };
    if (!code || !/^\d{6}$/.test(code)) {
      return NextResponse.json({ error: "Invalid code" }, { status: 400 });
    }

    // fetch latest matching, not-used code for this user+org
    const { rows } = await pool.query(
      `SELECT id, code, "expiresAt", used
         FROM "orgSecretCode"
        WHERE "userId" = $1
          AND "organizationId" = $2
          AND code = $3
        ORDER BY "createdAt" DESC
        LIMIT 1`,
      [userId, organizationId, code]
    );

    if (!rows.length) {
      return NextResponse.json({ error: "Invalid or expired code" }, { status: 400 });
    }

    const row = rows[0] as {
      id: string;
      code: string;
      expiresAt: string;
      used: boolean;
    };

    if (row.used) {
      return NextResponse.json({ error: "Code already used" }, { status: 400 });
    }

    const expired = Date.now() > new Date(row.expiresAt).getTime();
    if (expired) {
      return NextResponse.json({ error: "Code has expired" }, { status: 400 });
    }

    // success → return ticketId (use the row.id)
    return NextResponse.json({ ticketId: row.id });
  } catch (err) {
    console.error("[POST /change-secret/verify-code] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
