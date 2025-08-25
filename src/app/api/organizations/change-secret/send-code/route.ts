import { NextRequest, NextResponse } from "next/server";
import { pgPool as pool } from "@/lib/db";
import { getContext } from "@/lib/context";
import { auth } from "@/lib/auth";
import { sendEmail } from "@/lib/email";
import crypto from "crypto";
import { v4 as uuidv4 } from "uuid";

const CODE_TTL_MINUTES = 10;
const RESEND_COOLDOWN_SECONDS = 60;
const HMAC_SECRET =
  process.env.SECRET_CODE_SALT || process.env.ENCRYPTION_KEY || "fallback-secret";

function sixDigits() {
  return Math.floor(Math.random() * 1_000_000)
    .toString()
    .padStart(6, "0");
}

function hashCode(code: string, userId: string, organizationId: string) {
  return crypto
    .createHmac("sha256", HMAC_SECRET)
    .update(`${code}:${userId}:${organizationId}`)
    .digest("hex");
}

export async function POST(req: NextRequest) {
  try {
    // 1) Auth session
    const session = await auth.api.getSession({ headers: req.headers });
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    // 2) Active org context
    const ctx = await getContext(req);
    if (ctx instanceof NextResponse) return ctx;
    const { organizationId } = ctx;
    const userId = session.user.id;

    // 3) Cooldown (avoid spamming)
    const cooldownRes = await pool.query(
      `SELECT "createdAt"
         FROM "orgSecretCode"
        WHERE "organizationId" = $1 AND "userId" = $2
        ORDER BY "createdAt" DESC
        LIMIT 1`,
      [organizationId, userId]
    );
    if (cooldownRes.rows.length) {
      const last = new Date(cooldownRes.rows[0].createdAt).getTime();
      const now = Date.now();
      if ((now - last) / 1000 < RESEND_COOLDOWN_SECONDS) {
        return NextResponse.json(
          { error: "Please wait before requesting another code" },
          { status: 429 }
        );
      }
    }

    // 4) Make a fresh code; invalidate prior pending ones
    const code = sixDigits();
    const codeHash = hashCode(code, userId, organizationId);
    const expiresAt = new Date(Date.now() + CODE_TTL_MINUTES * 60 * 1000);
    const id = uuidv4(); // stored as text

    await pool.query(
      `UPDATE "orgSecretCode"
          SET "consumedAt" = now()
        WHERE "organizationId" = $1 AND "userId" = $2 AND "consumedAt" IS NULL`,
      [organizationId, userId]
    );

    await pool.query(
      `INSERT INTO "orgSecretCode"
        ("id","organizationId","userId","codeHash","expiresAt")
       VALUES ($1,$2,$3,$4,$5)`,
      [id, organizationId, userId, codeHash, expiresAt]
    );

    // 5) Email the code
    const userRes = await pool.query(`SELECT email FROM "user" WHERE id = $1`, [userId]);
    const email = userRes.rows[0]?.email as string | undefined;
    if (!email) {
      return NextResponse.json({ error: "User email not found" }, { status: 400 });
    }

    await sendEmail({
      to: email,
      subject: "Your Trapyfy verification code",
      text: `Use this code to change your organization's secret phrase: ${code}\n\nThis code expires in ${CODE_TTL_MINUTES} minutes.`,
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[POST /api/organizations/change-secret/send-code] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
