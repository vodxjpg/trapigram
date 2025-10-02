// src/lib/credits/auth.ts
import { NextRequest, NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import CIDR from "ip-cidr";

/** Reuse service-level envs for HMAC + IP allow-list */
let MASTER_KEY = "";
let HMAC_WINDOW_MS = 300_000;
let CIDRS: string[] = [];

function ensureEnv() {
  if (MASTER_KEY) return;
  MASTER_KEY = process.env.SERVICE_API_KEY ?? "";
  HMAC_WINDOW_MS = (Number(process.env.SERVICE_JWT_TTL) || 300) * 1000;
  CIDRS = (process.env.SERVICE_ALLOWED_CIDRS ?? "")
    .split(",").map((s) => s.trim()).filter(Boolean);
  if (!MASTER_KEY || CIDRS.length === 0) {
    throw new Error("SERVICE_API_KEY and SERVICE_ALLOWED_CIDRS are required");
  }
}

function toIPv4(raw: string) {
  if (raw === "::1") return "127.0.0.1";
  return raw.startsWith("::ffff:") ? raw.slice(7) : raw;
}
function ipAllowed(ipRaw: string): boolean {
  const ip = toIPv4((ipRaw || "").trim());
  if (!ip) return false;
  for (const c of CIDRS) {
    try {
      if (new CIDR(c).contains(ip)) return true;
    } catch { /* ignore bad CIDR */ }
  }
  return false;
}
export function extractClientIp(req: NextRequest): string {
  const cf = req.headers.get("cf-connecting-ip");
  if (cf) return cf;
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return (req as any).ip ?? "";
}

/** Validates IP allow-list + HMAC timestamp/signature for server-to-server calls. */
export function requireServerAuth(req: NextRequest): NextResponse | null {
  ensureEnv();

  const ip = extractClientIp(req);
  if (!ipAllowed(ip)) {
    return NextResponse.json({ error: "IP not allowed" }, { status: 403 });
  }

  const apiKey = req.headers.get("x-api-key") ?? "";
  if (apiKey !== MASTER_KEY) {
    return NextResponse.json({ error: "Invalid API key" }, { status: 401 });
  }

  const ts = req.headers.get("x-timestamp") ?? "";
  const sig = req.headers.get("x-signature") ?? "";
  const age = Math.abs(Date.now() - Number(ts));
  if (!ts || !sig || Number.isNaN(Number(ts)) || age > HMAC_WINDOW_MS) {
    return NextResponse.json({ error: "Bad timestamp" }, { status: 401 });
  }

  const expected = createHmac("sha256", MASTER_KEY).update(ts).digest("hex");
  try {
    if (!timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
      return NextResponse.json({ error: "Bad signature" }, { status: 401 });
    }
  } catch {
    return NextResponse.json({ error: "Bad signature" }, { status: 401 });
  }

  return null; // OK
}
