// src/app/api/organizations/change-secret/verify-code/route.ts
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { pgPool as pool } from "@/lib/db";
import { getContext } from "@/lib/context";
import crypto from "crypto";
import { v4 as uuidv4 } from "uuid";

const HMAC_SECRET =
  process.env.SECRET_CODE_SALT || process.env.ENCRYPTION_KEY || "fallback-secret";

function hashCode(code: string, userId: string, organizationId: string) {
  return crypto
    .createHmac("sha256", HMAC_SECRET)
    .update(`${code}:${userId}:${organizationId}`)
    .digest("hex");
}

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

    const codeHash = hashCode(code, userId, organizationId);
    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      // Look up the most recent matching codeHash for this user+org.
      const res = await client.query(
        `SELECT id, "expiresAt", "verifiedAt", "consumedAt", "ticketId"
           FROM "orgSecretCode"
          WHERE "organizationId" = $1
            AND "userId"        = $2
            AND "codeHash"      = $3
          ORDER BY "createdAt" DESC
          LIMIT 1
          FOR UPDATE`,
        [organizationId, userId, codeHash]
      );

      if (res.rows.length === 0) {
        await client.query("ROLLBACK");
        return NextResponse.json(
          { error: "Invalid or expired code" },
          { status: 400 }
        );
      }

      const row = res.rows[0] as {
        id: string;
        expiresAt: string;
        verifiedAt: string | null;
        consumedAt: string | null;
        ticketId: string | null;
      };

      if (row.consumedAt) {
        await client.query("ROLLBACK");
        return NextResponse.json(
          { error: "Code already used" },
          { status: 400 }
        );
      }

      const isExpired = Date.now() > new Date(row.expiresAt).getTime();
      if (isExpired) {
        await client.query("ROLLBACK");
        return NextResponse.json(
          { error: "Code has expired" },
          { status: 400 }
        );
      }

      // If already verified and not consumed, re-use its ticketId.
      let ticketId = row.ticketId;
      if (!row.verifiedAt || !row.ticketId) {
        ticketId = uuidv4();
        await client.query(
          `UPDATE "orgSecretCode"
              SET "verifiedAt" = now(),
                  "ticketId"   = $1
            WHERE id = $2`,
          [ticketId, row.id]
        );
      }

      await client.query("COMMIT");
      return NextResponse.json({ ticketId });
    } catch (err) {
      await client.query("ROLLBACK");
      console.error("[POST /change-secret/verify-code] tx error:", err);
      return NextResponse.json(
        { error: "Internal server error" },
        { status: 500 }
      );
    } finally {
      client.release();
    }
  } catch (err) {
    console.error("[POST /change-secret/verify-code] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
