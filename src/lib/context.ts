/* src/lib/context.ts */
import { NextRequest, NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import { verify as jwtVerify, JwtPayload } from "jsonwebtoken";
import net from "net";
import fs from "fs";
import path from "path";
import { CIDR } from "ip-cidr";               // ← NEW

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
  const xff = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return xff || (req as any).ip || "";
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
      return false;                           // ignore malformed CIDR
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

/* ---------- resolveServiceAccount (unchanged) ---------- */
async function resolveServiceAccount(
  organizationId: string
): Promise<RequestContext | NextResponse> {
  console.log(`Resolving service account for organizationId: ${organizationId}`);
  const orgRow = await db
    .selectFrom("organization")
    .select("metadata")
    .where("id", "=", organizationId)
    .executeTakeFirst();

  if (!orgRow) {
    console.log(`Organization not found: ${organizationId}`);
    return NextResponse.json({ error: "Organization not found" }, { status: 404 });
  }

  let tenantId: string | undefined;
  if (orgRow.metadata) {
    try {
      const meta =
        typeof orgRow.metadata === "string"
          ? JSON.parse(orgRow.metadata)
          : orgRow.metadata;
      tenantId = meta?.tenantId;
      console.log(`Tenant ID from metadata: ${tenantId}`);
    } catch (e) {
      console.log(`Failed to parse organization metadata: ${e.message}`);
    }
  }

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
      console.log(`Tenant ID from owner: ${tenantId}`);
    }
  }

  if (!tenantId) {
    console.log(`Unable to determine tenantId for organization: ${organizationId}`);
    return NextResponse.json(
      { error: "Unable to determine tenantId for organization" },
      { status: 500 }
    );
  }

  return { organizationId, userId: "service-account", tenantId };
}

/* ---------- resolveGuestTenant (unchanged) ------------- */
async function resolveGuestTenant(
  organizationId: string
): Promise<string | NextResponse> {
  const orgRow = await db
    .selectFrom("organization")
    .select("metadata")
    .where("id", "=", organizationId)
    .executeTakeFirst();

  let tenantId: string | undefined;
  if (orgRow?.metadata) {
    try {
      const meta =
        typeof orgRow.metadata === "string"
          ? JSON.parse(orgRow.metadata)
          : orgRow.metadata;
      tenantId = meta?.tenantId;
    } catch {
      /* ignore parse error */
    }
  }

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

/* ---------- getContext (unchanged except ipAllowed logic) ---------- */
export async function getContext(
  req: NextRequest
): Promise<RequestContext | NextResponse> {

  const authz = req.headers.get("authorization") ?? "";
  const apiKey = req.headers.get("x-api-key") ?? "";

  if (authz.startsWith("Bearer ")) {
    const ip = clientIp(req);
    if (!ipAllowed(ip)) {
      return NextResponse.json({ error: "IP not allowed" }, { status: 403 });
    }

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

    // ─── who is the owner of this key? ───────────────────────────────
    const ownerUserId =
      user?.id                         // service key ⇒ we already have user
      ?? key?.creatorUserId            // personal key ⇒ Clerk puts it here
      ?? key?.userId                   // (older SDKs)
      ?? undefined;
    
    if (! ownerUserId) {
      return NextResponse.json(
        { error: "Unable to resolve key owner" },
        { status: 401 },
      );
    }
    
    const tenantRow = await db
      .selectFrom("tenant")
      .select("id")
      .where("ownerUserId", "=", ownerUserId)
      .executeTakeFirst();
    
    if (tenantRow) {
      return { organizationId, userId: ownerUserId, tenantId: tenantRow.id };
    }

    const tenantResult = await resolveGuestTenant(organizationId);
    if (tenantResult instanceof NextResponse) return tenantResult;
    return { organizationId, userId: user.id, tenantId: tenantResult };
  }

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

  const tenantRow = await db
    .selectFrom("tenant")
    .select("id")
    .where("ownerUserId", "=", userId)
    .executeTakeFirst();

  if (tenantRow) {
    return { organizationId, userId, tenantId: tenantRow.id };
  }

  const tenantResult = await resolveGuestTenant(organizationId);
  if (tenantResult instanceof NextResponse) return tenantResult;
  return { organizationId, userId, tenantId: tenantResult };
}
