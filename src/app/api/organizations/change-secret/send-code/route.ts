export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { pgPool as pool } from "@/lib/db";
import { getContext } from "@/lib/context";
import crypto from "crypto";
import { sendEmail } from "@/lib/email";

const COOLDOWN_SECONDS = 60;            // resend throttle (server-side)
const EXPIRES_MINUTES = 10;             // code lifetime

function randomCode(): string {
  const n = crypto.randomInt(0, 1_000_000);
  return n.toString().padStart(6, "0");
}
function randomId(): string {
  return crypto.randomBytes(16).toString("hex"); // text id (not uuid)
}

export async function POST(req: NextRequest) {
  try {
    // session/org context
    const ctx = await getContext(req);
    if (ctx instanceof NextResponse) return ctx;
    const { userId, userEmail, organizationId } = ctx;

    if (!userId || !organizationId || !userEmail) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // enforce cooldown by user+org
    const { rows: lastRows } = await pool.query(
      `SELECT "createdAt"
         FROM "orgSecretCode"
        WHERE "userId" = $1 AND "organizationId" = $2
        ORDER BY "createdAt" DESC
        LIMIT 1`,
      [userId, organizationId]
    );

    if (lastRows.length) {
      const last = new Date(lastRows[0].createdAt).getTime();
      const now = Date.now();
      if (now - last < COOLDOWN_SECONDS * 1000) {
        return NextResponse.json(
          { error: "Please wait before requesting another code" },
          { status: 429 }
        );
      }
    }

    // create fresh code row
    const id = randomId();
    const code = randomCode();
    const createdAt = new Date();
    const expiresAt = new Date(Date.now() + EXPIRES_MINUTES * 60_000);

    await pool.query(
      `INSERT INTO "orgSecretCode"
        (id, "userId", "organizationId", email, code, "createdAt", "expiresAt", used)
       VALUES ($1,$2,$3,$4,$5,$6,$7,false)`,
      [id, userId, organizationId, userEmail, code, createdAt, expiresAt]
    );

    // email the 6-digit code
    await sendEmail({
      to: userEmail,
      subject: "Your verification code",
      text: `Your code is: ${code}\n\nIt expires in ${EXPIRES_MINUTES} minutes.`,
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[POST /change-secret/send-code] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
