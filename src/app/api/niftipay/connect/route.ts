// /home/zodx/Desktop/trapigram/src/app/api/niftipay/connect/route.ts
import { NextRequest, NextResponse } from "next/server";
import { db, pgPool as pool } from "@/lib/db";
import { getContext } from "@/lib/context";
import { v4 as uuidv4 } from "uuid";

const BASE = (process.env.NIFTIPAY_API_URL || "https://www.niftipay.com").replace(/\/+$/, "");
const OAUTH_CLIENT_ID = process.env.NIFTIPAY_OAUTH_CLIENT_ID || "";
const OAUTH_CLIENT_SECRET = process.env.NIFTIPAY_OAUTH_CLIENT_SECRET || "";

/**
 * POST /api/niftipay/connect
 *
 * Steps:
 *  1) Resolve tenantId (same pattern as other Niftipay routes).
 *  2) Determine merchant email (body.email preferred, else context.user.email).
 *  3) Request token from Niftipay /oauth/token using client_credentials (Basic auth).
 *  4) Call Niftipay /api/third-party/provision with Authorization: Bearer <token>.
 *  5) Upsert "Niftipay" payment method with returned apiKey.
 */
type OrgMeta = { tenantId?: string };

function problem(msg: string, code = 400) {
  return NextResponse.json({ error: msg }, { status: code });
}

export async function POST(req: NextRequest) {
  if (!OAUTH_CLIENT_ID || !OAUTH_CLIENT_SECRET) {
    return problem("Server misconfigured: NIFTIPAY_OAUTH_CLIENT_ID/SECRET not set", 500);
  }

  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;

  // 1) resolve tenantId
  const org = await db
    .selectFrom("organization")
    .select(["metadata"])
    .where("id", "=", ctx.organizationId)
    .executeTakeFirst();

  let tenantId: string | null = null;
  if (org?.metadata) {
    try {
      tenantId = (JSON.parse(org.metadata as string) as OrgMeta).tenantId ?? null;
    } catch {
      /* ignore parse error */
    }
  }
  if (!tenantId) {
    return problem("Organization tenantId not configured", 404);
  }

  // 2) merchant email
  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) ?? {};
  } catch {
    /* no body */
  }
  const providedEmail =
    typeof body.email === "string" && body.email.includes("@")
      ? (body.email as string)
      : undefined;
  const providedName =
    typeof body.name === "string" && body.name.trim() ? (body.name as string) : undefined;

  const ctxEmail =
    (ctx as any).user?.email && typeof (ctx as any).user.email === "string"
      ? ((ctx as any).user.email as string)
      : undefined;

  const email = providedEmail || ctxEmail;
  if (!email) {
    return problem(
      "Email is required. Send { email } in body or expose it in getContext().user.email.",
      400,
    );
  }

  // 3) Token (client credentials)
  const basic = Buffer.from(`${OAUTH_CLIENT_ID}:${OAUTH_CLIENT_SECRET}`).toString("base64");
  const tokenRes = await fetch(`${BASE}/oauth/token`, {
    method: "POST",
    headers: {
      "Authorization": `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ grant_type: "client_credentials", scope: "provision:apikey" }),
  });

  if (!tokenRes.ok) {
    const detail = await tokenRes.text().catch(() => "");
    return problem(`Failed to obtain token from Niftipay: ${detail.slice(0, 300)}`, tokenRes.status);
  }

  const { access_token } = (await tokenRes.json()) as { access_token: string };
  if (!access_token) {
    return problem("Niftipay did not return access_token", 502);
  }

  // 4) Provision on Niftipay
  const upstream = await fetch(`${BASE}/api/third-party/provision`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${access_token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      email,
      name: providedName,
      tenantId,
      keyName: "Trapigram Bridge",
    }),
  });

  if (!upstream.ok) {
    const detail = await upstream.text().catch(() => "");
    return problem(`Failed to provision on Niftipay: ${detail.slice(0, 300)}`, upstream.status);
  }

  const { apiKey } = (await upstream.json()) as { apiKey: string };
  if (!apiKey) {
    return problem("Niftipay did not return an apiKey", 502);
  }

  // 5) Upsert payment method
  const existing = await db
    .selectFrom("paymentMethods")
    .select(["id"])
    .where("tenantId", "=", tenantId)
    .where("name", "=", "Niftipay")
    .executeTakeFirst();

  if (existing?.id) {
    const sql = `
      UPDATE "paymentMethods"
         SET "apiKey" = $1,
             "active" = TRUE,
             "updatedAt" = NOW()
       WHERE id = $2
       RETURNING id, name, active, "apiKey"
    `;
    const { rows } = await pool.query(sql, [apiKey, existing.id]);
    return NextResponse.json({ updated: true, method: rows[0] }, { status: 200 });
  } else {
    const id = uuidv4();
    const sql = `
      INSERT INTO "paymentMethods"
        (id, name, active, "apiKey", "secretKey", "tenantId", "createdAt", "updatedAt")
      VALUES ($1, $2, TRUE, $3, NULL, $4, NOW(), NOW())
      RETURNING id, name, active, "apiKey"
    `;
    const { rows } = await pool.query(sql, [id, "Niftipay", apiKey, tenantId]);
    return NextResponse.json({ created: true, method: rows[0] }, { status: 201 });
  }
}
