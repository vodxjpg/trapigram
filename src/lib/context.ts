/*──────────────────────────────────────────────────────────────────
  src/lib/context.ts
──────────────────────────────────────────────────────────────────*/
import { NextRequest, NextResponse }   from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import { verify as jwtVerify, JwtPayload } from "jsonwebtoken";
import net  from "net";
import fs   from "fs";
import path from "path";

import { auth } from "@/lib/auth";
import { db   } from "@/lib/db";
import { loadKey } from "@/lib/readKey";

/*──────────────────── Types ────────────────────*/
export type RequestContext = {
  organizationId: string;
  userId:         string;
  tenantId:       string;
};



/*──────────────────── Constants & sanity checks ────────────────────*/
const SERVICE_API_KEY = process.env.SERVICE_API_KEY ?? "";
if (!SERVICE_API_KEY) throw new Error("SERVICE_API_KEY env missing");

const SERVICE_ALLOWED_CIDRS = (process.env.SERVICE_ALLOWED_CIDRS ?? "")
  .split(",")
  .map(s => s.trim())
  .filter(Boolean);

if (SERVICE_ALLOWED_CIDRS.length === 0) {
  throw new Error("SERVICE_ALLOWED_CIDRS env missing");
}

const JWT_PUBLIC_KEY = loadKey(
    process.env.SERVICE_JWT_PUBLIC_KEY          // inline first …
      ?? process.env.SERVICE_JWT_PUBLIC_KEY_PATH // … or file path
  );
if (!JWT_PUBLIC_KEY) throw new Error("JWT public key missing (env or file)");

const HMAC_WINDOW_MS =
  (Number(process.env.SERVICE_JWT_TTL) || 300) * 1_000;   // default 300 s

/*──────────────────── Low-level helpers ────────────────────*/
function clientIp(req: NextRequest): string {
  const xff = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  // Edge runtime sets req.ip; Node runtime doesn’t.
  return xff || (req as any).ip || "";
}

function ipToInt(ip: string) {
  return ip.split(".").reduce((acc, oct) => (acc << 8) + Number(oct), 0) >>> 0;
}
function ipAllowed(ipStr: string): boolean {
  /* ── normalise local IPv6 forms ───────────────────────────── */
  if (ipStr === "::1")         ipStr = "127.0.0.1";          // pure IPv6 loopback
  if (ipStr.startsWith("::ffff:"))
    ipStr = ipStr.slice(7);                                 // IPv6-mapped IPv4

  /* ── original logic (unchanged) ──────────────────────────── */
  if (!net.isIP(ipStr)) return false;

  return SERVICE_ALLOWED_CIDRS.some(cidr => {
    if (!cidr.includes("/")) return cidr === ipStr;

    const [base, bits] = cidr.split("/");
    const mask         = -1 >>> (32 - Number(bits));
    return (ipToInt(ipStr) & mask) === (ipToInt(base) & mask);
  });
}


function keysEqual(incoming: string) {
  const a = Buffer.from(incoming);
  const b = Buffer.from(SERVICE_API_KEY);
  return a.length === b.length && timingSafeEqual(a, b);
}

function validHmac(ts: string, sig: string) {
  const age = Math.abs(Date.now() - Number(ts));
  if (Number.isNaN(Number(ts)) || age > HMAC_WINDOW_MS) return false;
  const expected = createHmac("sha256", SERVICE_API_KEY)
    .update(ts)
    .digest("hex");
  return timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
}

/*──────────────────── Service-account resolver ────────────────────*/
async function resolveServiceAccount(
  organizationId: string,
): Promise<RequestContext | NextResponse> {

  /* 1a – prefer org.metadata.tenantId */
  const orgRow = await db
    .selectFrom("organization")
    .select("metadata")
    .where("id", "=", organizationId)
    .executeTakeFirst();

  if (!orgRow) {
    return NextResponse.json({ error: "Organization not found" }, { status: 404 });
  }

  let tenantId: string | undefined;
  if (orgRow.metadata) {
    try {
      const meta = typeof orgRow.metadata === "string"
        ? JSON.parse(orgRow.metadata)
        : orgRow.metadata;
      tenantId = meta?.tenantId;
    } catch { /* ignore parse error – fallback below */ }
  }

  /* 1b – owner ➜ tenant (fallback) */
  if (!tenantId) {
    const owner = await db
      .selectFrom("member")
      .select("userId")
      .where("organizationId", "=", organizationId)
      .where("role", "=", "owner")
      .executeTakeFirst();

    if (owner) {
      const t = await db
        .selectFrom("tenant")
        .select("id")
        .where("ownerUserId", "=", owner.userId)
        .executeTakeFirst();
      tenantId = t?.id;
    }
  }

  if (!tenantId) {
    return NextResponse.json(
      { error: "Unable to determine tenantId for organization" },
      { status: 500 },
    );
  }

  return { organizationId, userId: "service-account", tenantId };
}

/*──────────────────── Shared guest-fallback helper ────────────────────*/
async function resolveGuestTenant(
  organizationId: string,
): Promise<string | NextResponse> {
  /* metadata.tenantId first */
  const orgRow = await db
    .selectFrom("organization")
    .select("metadata")
    .where("id", "=", organizationId)
    .executeTakeFirst();

  let tenantId: string | undefined;
  if (orgRow?.metadata) {
    try {
      const meta = typeof orgRow.metadata === "string"
        ? JSON.parse(orgRow.metadata)
        : orgRow.metadata;
      tenantId = meta?.tenantId;
    } catch { /* ignore parse error */ }
  }

  /* owner ➜ tenant */
  if (!tenantId) {
    const owner = await db
      .selectFrom("member")
      .select("userId")
      .where("organizationId", "=", organizationId)
      .where("role", "=", "owner")
      .executeTakeFirst();

    if (owner) {
      const t = await db
        .selectFrom("tenant")
        .select("id")
        .where("ownerUserId", "=", owner.userId)
        .executeTakeFirst();
      tenantId = t?.id;
    }
  }

  if (!tenantId) {
    return NextResponse.json({ error: "No tenant found for user" }, { status: 404 });
  }
  return tenantId;
}

/*──────────────────── Public entrypoint ────────────────────*/
export async function getContext(
  req: NextRequest,
): Promise<RequestContext | NextResponse> {
  const authz  = req.headers.get("authorization") ?? "";
  const apiKey = req.headers.get("x-api-key")     ?? "";

  /*───────────────────────────────────────────────
    1 — SERVICE-JWT (Bearer …)
  ────────────────────────────────────────────────*/
  if (authz.startsWith("Bearer ")) {
    /* IP gate *only* for service account */
    const ip = clientIp(req);
    if (!ipAllowed(ip)) {
      return NextResponse.json({ error: "IP not allowed" }, { status: 403 });
    }

    try {
      const token   = authz.slice(7);
      const payload = jwtVerify(token, JWT_PUBLIC_KEY, { algorithms: ["RS256"] }) as JwtPayload;

      if (payload.sub !== "service-account") throw new Error("sub mismatch");

      const organizationId = new URL(req.url).searchParams.get("organizationId");
      if (!organizationId) {
        return NextResponse.json(
          { error: "organizationId query parameter is required" },
          { status: 400 },
        );
      }
      return resolveServiceAccount(organizationId);
    } catch {
      return NextResponse.json({ error: "Invalid or expired token" }, { status: 401 });
    }
  }

  /*───────────────────────────────────────────────
    2 — SERVICE_API_KEY + HMAC (fallback)
  ────────────────────────────────────────────────*/
  if (apiKey && keysEqual(apiKey)) {
    /* IP gate *only* for service account */
    const ip = clientIp(req);
    if (!ipAllowed(ip)) {
      return NextResponse.json({ error: "IP not allowed" }, { status: 403 });
    }

    const ts  = req.headers.get("x-timestamp") ?? "";
    const sig = req.headers.get("x-signature") ?? "";
    if (!ts || !sig || !validHmac(ts, sig)) {
      return NextResponse.json({ error: "Bad HMAC or timestamp" }, { status: 401 });
    }

    const organizationId = new URL(req.url).searchParams.get("organizationId");
    if (!organizationId) {
      return NextResponse.json(
        { error: "organizationId query parameter is required" },
        { status: 400 },
      );
    }
    return resolveServiceAccount(organizationId);
  }

  /*───────────────────────────────────────────────
    3 — PERSONAL API KEY (Better-Auth)
  ────────────────────────────────────────────────*/
  if (apiKey) {
    const { valid, error, user } = await auth.api.verifyApiKey({ body: { key: apiKey } });
    if (!valid) {
      return NextResponse.json(
        { error: error?.message || "Invalid API key" },
        { status: 401 },
      );
    }

    const organizationId = new URL(req.url).searchParams.get("organizationId");
    if (!organizationId) {
      return NextResponse.json(
        { error: "organizationId query parameter is required" },
        { status: 400 },
      );
    }

    /* owner-tenant first */
    const tenantRow = await db
      .selectFrom("tenant")
      .select("id")
      .where("ownerUserId", "=", user.id)
      .executeTakeFirst();

    if (tenantRow) {
      return { organizationId, userId: user.id, tenantId: tenantRow.id };
    }

    /* guest fallbacks */
    const tenantResult = await resolveGuestTenant(organizationId);
    if (tenantResult instanceof NextResponse) return tenantResult;
    return { organizationId, userId: user.id, tenantId: tenantResult };
  }

  /*───────────────────────────────────────────────
    4 — SESSION COOKIE (browser flow)
  ────────────────────────────────────────────────*/
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let organizationId =
    new URL(req.url).searchParams.get("organizationId") ||
    session.session.activeOrganizationId;

  if (!organizationId) {
    return NextResponse.json({ error: "No active organization" }, { status: 400 });
  }

  const userId = session.user.id;

  /* owner-tenant preferred */
  const tenantRow = await db
    .selectFrom("tenant")
    .select("id")
    .where("ownerUserId", "=", userId)
    .executeTakeFirst();

  if (tenantRow) {
    return { organizationId, userId, tenantId: tenantRow.id };
  }

  /* guest fallbacks */
  const tenantResult = await resolveGuestTenant(organizationId);
  if (tenantResult instanceof NextResponse) return tenantResult;
  return { organizationId, userId, tenantId: tenantResult };
}
