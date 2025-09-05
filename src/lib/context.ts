/* src/lib/context.ts */
import { NextRequest, NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import { verify as jwtVerify, JwtPayload } from "jsonwebtoken";
import net from "net";
import fs from "fs";
import path from "path";
import CIDR from "ip-cidr";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { loadKey } from "@/lib/readKey";

export type RequestContext = {
  organizationId: string;
  userId: string;
  tenantId: string;
};

const SERVICE_API_KEY = process.env.SERVICE_API_KEY ?? "";
if (!SERVICE_API_KEY) throw new Error("SERVICE_API_KEY env missing");

const SERVICE_ALLOWED_CIDRS = (process.env.SERVICE_ALLOWED_CIDRS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
if (SERVICE_ALLOWED_CIDRS.length === 0) {
  throw new Error("SERVICE_ALLOWED_CIDRS env missing");
}

const JWT_PUBLIC_KEY = loadKey(
  process.env.SERVICE_JWT_PUBLIC_KEY ?? process.env.SERVICE_JWT_PUBLIC_KEY_PATH
);
if (!JWT_PUBLIC_KEY) {
  throw new Error("JWT public key missing (env or file)");
}

const HMAC_WINDOW_MS = (Number(process.env.SERVICE_JWT_TTL) || 300) * 1_000;

function clientIp(req: NextRequest): string {
  const cf = req.headers.get("cf-connecting-ip");
  if (cf) return cf;
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return (req as any).ip ?? "";
}

function ipToInt(ip: string) {
  return ip.split(".").reduce((acc, oct) => (acc << 8) + Number(oct), 0) >>> 0;
}

function ipAllowed(ipStr: string): boolean {
  if (ipStr === "::1") ipStr = "127.0.0.1";
  if (ipStr.startsWith("::ffff:")) ipStr = ipStr.slice(7);
  if (!net.isIP(ipStr)) return false;

  return SERVICE_ALLOWED_CIDRS.some((cidr) => {
    try {
      return new CIDR(cidr).contains(ipStr);
    } catch {
      return false; // ignore malformed CIDR
    }
  });
}

function keysEqual(incoming: string) {
  const a = Buffer.from(incoming);
  const b = Buffer.from(SERVICE_API_KEY);
  return a.length === b.length && timingSafeEqual(a, b);
}

function validHmac(ts: string, sig: string) {
  const now = Date.now();
  const age = Math.abs(now - Number(ts));
  console.log(`Server time: ${now}, Received ts: ${ts}, Age: ${age} ms`);
  if (Number.isNaN(Number(ts)) || age > HMAC_WINDOW_MS) {
    console.log("Timestamp invalid or too old");
    return false;
  }
  const expected = createHmac("sha256", SERVICE_API_KEY).update(ts).digest("hex");
  console.log(`Expected sig: ${expected}, Received sig: ${sig}`);
  return timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
}

/* ------------------------------------------------------------------ */
/* Resolve the tenant that OWNS the given organization                */
/* 1) Try organization.metadata.tenantId                               */
/* 2) Fallback: org owner (member.role='owner') → tenant.ownerUserId   */
/* ------------------------------------------------------------------ */
async function resolveOrgTenantId(organizationId: string): Promise<string | null> {
  const orgRow = await db
    .selectFrom("organization")
    .select(["id", "metadata"])
    .where("id", "=", organizationId)
    .executeTakeFirst();

  if (!orgRow) return null;

  if (orgRow.metadata) {
    try {
      const meta =
        typeof orgRow.metadata === "string"
          ? JSON.parse(orgRow.metadata || "{}")
          : orgRow.metadata;
      if (meta?.tenantId) return String(meta.tenantId);
    } catch {
      /* ignore parse error */
    }
  }

  const owner = await db
    .selectFrom("member")
    .select(["userId"])
    .where("organizationId", "=", organizationId)
    .where("role", "=", "owner")
    .executeTakeFirst();

  if (!owner?.userId) return null;

  const t = await db
    .selectFrom("tenant")
    .select(["id"])
    .where("ownerUserId", "=", owner.userId)
    .executeTakeFirst();

  return t?.id ?? null;
}

/* ---------- service-account using org tenant ---------- */
async function resolveServiceAccount(
  organizationId: string
): Promise<RequestContext | NextResponse> {
  console.log(`Resolving service account for organizationId: ${organizationId}`);

  const tenantId = await resolveOrgTenantId(organizationId);
  if (!tenantId) {
    console.log(`Unable to determine tenantId for organization: ${organizationId}`);
    return NextResponse.json(
      { error: "Unable to determine tenantId for organization" },
      { status: 500 }
    );
  }

  return { organizationId, userId: "service-account", tenantId };
}

/* ---------- guest utils kept for compatibility ---------- */
async function resolveGuestTenant(
  organizationId: string
): Promise<string | NextResponse> {
  const tenantId = await resolveOrgTenantId(organizationId);
  if (!tenantId) {
    return NextResponse.json({ error: "No tenant found for user" }, { status: 404 });
  }
  return tenantId;
}

/* ---------- main context resolver ---------- */
export async function getContext(
  req: NextRequest
): Promise<RequestContext | NextResponse> {
  const authz = req.headers.get("authorization") ?? "";
  const apiKey = req.headers.get("x-api-key") ?? "";

  /* ----- Service JWT (RS256) ----- */
  if (authz.startsWith("Bearer ")) {
    try {
      const token = authz.slice(7);
      const payload = jwtVerify(token, JWT_PUBLIC_KEY, { algorithms: ["RS256"] }) as JwtPayload;

      if (payload.sub !== "service-account") {
        throw new Error("sub mismatch");
      }

      const organizationId = new URL(req.url).searchParams.get("organizationId");
      if (!organizationId) {
        console.log("Missing organizationId query parameter");
        return NextResponse.json(
          { error: "organizationId query parameter is required" },
          { status: 400 }
        );
      }
      return resolveServiceAccount(organizationId);
    } catch (e) {
      console.error("JWT verification failed:", (e as Error).message);
      console.error(
        "JWT_PUBLIC_KEY used:",
        JWT_PUBLIC_KEY.replace(/\n/g, "\\n").slice(0, 100) + "..."
      );
      return NextResponse.json(
        { error: `Invalid or expired token: ${(e as Error).message}` },
        { status: 401 }
      );
    }
  }

  /* ----- HMAC + IP allowlist (service key) ----- */
  if (apiKey && keysEqual(apiKey)) {
    const ip = clientIp(req);
    if (!ipAllowed(ip)) {
      return NextResponse.json({ error: "IP not allowed" }, { status: 403 });
    }

    const ts = req.headers.get("x-timestamp") ?? "";
    const sig = req.headers.get("x-signature") ?? "";
    if (!ts || !sig || !validHmac(ts, sig)) {
      return NextResponse.json({ error: "Bad HMAC or timestamp" }, { status: 401 });
    }

    const organizationId = new URL(req.url).searchParams.get("organizationId");
    if (!organizationId) {
      return NextResponse.json(
        { error: "organizationId query parameter is required" },
        { status: 400 }
      );
    }
    return resolveServiceAccount(organizationId);
  }

  /* ----- Personal/API keys via Auth provider ----- */
  if (apiKey) {
    const { valid, error, user, key } =
      await auth.api.verifyApiKey({ body: { key: apiKey } });
    if (!valid) {
      return NextResponse.json(
        { error: error?.message || "Invalid API key" },
        { status: 401 }
      );
    }

    const organizationId = new URL(req.url).searchParams.get("organizationId");
    if (!organizationId) {
      return NextResponse.json(
        { error: "organizationId query parameter is required" },
        { status: 400 }
      );
    }

    // Keep userId for auditing; tenantId is always the organization's tenant.
    const ownerUserId =
      user?.id ??
      key?.creatorUserId ??
      key?.userId ??
      undefined;

    if (!ownerUserId) {
      return NextResponse.json(
        { error: "Unable to resolve key owner" },
        { status: 401 }
      );
    }

    const orgTenantId = await resolveOrgTenantId(organizationId);
    if (!orgTenantId) {
      return NextResponse.json(
        { error: "Unable to determine tenant for organization" },
        { status: 500 }
      );
    }
    return { organizationId, userId: ownerUserId, tenantId: orgTenantId };
  }

  /* ----- Session (browser) ----- */
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) {
    console.log("No session found");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let organizationId =
    new URL(req.url).searchParams.get("organizationId") ||
    session.session.activeOrganizationId;

  if (!organizationId) {
    console.log("No active organization found");
    return NextResponse.json({ error: "No active organization" }, { status: 400 });
  }

  const userId = session.user.id;

  // Always use org tenant (metadata → owner fallback)
  const orgTenantId = await resolveOrgTenantId(organizationId);
  if (!orgTenantId) {
    return NextResponse.json(
      { error: "Unable to determine tenant for organization" },
      { status: 500 }
    );
  }

  return { organizationId, userId, tenantId: orgTenantId };
}
