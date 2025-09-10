// /home/zodx/Desktop/trapigram/src/app/api/niftipay/connect/route.ts
import { NextRequest, NextResponse } from "next/server";
import { db, pgPool as pool } from "@/lib/db";
import { getContext } from "@/lib/context";
import { v4 as uuidv4 } from "uuid";

const BASE = (process.env.NIFTIPAY_API_URL || "https://www.niftipay.com").replace(/\/+$/, "");
const OAUTH_CLIENT_ID = process.env.NIFTIPAY_OAUTH_CLIENT_ID || "";
const OAUTH_CLIENT_SECRET = process.env.NIFTIPAY_OAUTH_CLIENT_SECRET || "";

type OrgMeta = { tenantId?: string };
type CurrentUserRes = {
  user?: {
    id: string;
    email?: string;
    name?: string | null;
  };
};

function problem(msg: string, code = 400) {
  return NextResponse.json({ error: msg }, { status: code });
}

/**
 * Resolve email (and optional name) for the current merchant:
 * 1) body.email / body.name if provided
 * 2) GET /api/users/current with forwarded cookies (same-origin)
 */
async function resolveMerchantIdentity(
  req: NextRequest,
  body: Record<string, unknown>,
): Promise<{ email: string; name?: string }> {
  const providedEmail =
    typeof body.email === "string" && body.email.includes("@") ? (body.email as string) : undefined;
  const providedName =
    typeof body.name === "string" && body.name.trim() ? (body.name as string) : undefined;

  if (providedEmail) {
    return { email: providedEmail, name: providedName };
  }

  // Fallback to /api/users/current
  const origin = new URL(req.url).origin;
  const cookie = req.headers.get("cookie") ?? "";
  const meRes = await fetch(`${origin}/api/users/current`, {
    method: "GET",
    headers: cookie ? { cookie } : {},
  });

  if (!meRes.ok) {
    throw new Error(`Failed to resolve current user (${meRes.status})`);
  }

  const me = (await meRes.json()) as CurrentUserRes;
  const email = me?.user?.email;
  const name = providedName ?? (me?.user?.name || undefined);

  if (!email || !email.includes("@")) {
    throw new Error("Unable to resolve merchant email (no session email available)");
  }
  return { email, name };
}

export async function POST(req: NextRequest) {
  if (!OAUTH_CLIENT_ID || !OAUTH_CLIENT_SECRET) {
    return problem("Server misconfigured: NIFTIPAY_OAUTH_CLIENT_ID/SECRET not set", 500);
  }

  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;

  // 1) resolve tenantId (unchanged)
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

  // 2) parse body and resolve merchant email/name
  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) ?? {};
  } catch {
    /* no body */
  }

  let identity: { email: string; name?: string };
  try {
    identity = await resolveMerchantIdentity(req, body);
  } catch (e: any) {
    return problem(e?.message || "Email is required", 400);
  }

  // 3) Token (client credentials) — unchanged
  const basic = Buffer.from(`${OAUTH_CLIENT_ID}:${OAUTH_CLIENT_SECRET}`).toString("base64");
  const tokenRes = await fetch(`${BASE}/oauth/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
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

  // 4) Provision on Niftipay — unchanged except we pass resolved email/name
  const upstream = await fetch(`${BASE}/api/third-party/provision`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${access_token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      email: identity.email,
      name: identity.name,
      tenantId,
      keyName: "Trapigram Bridge",
    }),
  });

  if (!upstream.ok) {
    // Prefer upstream JSON { error } if available for a clean message
    let message = "Failed to provision on Niftipay";
    try {
      const text = await upstream.text();
      try {
        const j = JSON.parse(text);
        if (j && typeof j.error === "string") {
          message = j.error;
        } else {
          message = `${message}: ${text.slice(0, 300)}`;
        }
      } catch {
        message = `${message}: ${text.slice(0, 300)}`;
      }
    } catch { }
    return problem(message, upstream.status);
  }

  const { apiKey } = (await upstream.json()) as { apiKey: string };
  if (!apiKey) {
    return problem("Niftipay did not return an apiKey", 502);
  }

  // 5) Upsert payment methods
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
