// src/lib/internalAuth.ts
import { NextRequest, NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import net from "net";
import CIDR from "ip-cidr";

const SERVICE_API_KEY = process.env.SERVICE_API_KEY ?? "";
if (!SERVICE_API_KEY) throw new Error("SERVICE_API_KEY env missing");

const SERVICE_ALLOWED_CIDRS = (process.env.SERVICE_ALLOWED_CIDRS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
if (SERVICE_ALLOWED_CIDRS.length === 0) {
  throw new Error("SERVICE_ALLOWED_CIDRS env missing");
}

const HMAC_WINDOW_MS = (Number(process.env.SERVICE_JWT_TTL) || 300) * 1_000;

function clientIp(req: NextRequest): string {
  const cf = req.headers.get("cf-connecting-ip");
  if (cf) return cf;
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return "";
}

function ipAllowed(ipStr: string): boolean {
  if (ipStr === "::1") ipStr = "127.0.0.1";
  if (ipStr.startsWith("::ffff:")) ipStr = ipStr.slice(7);
  if (!net.isIP(ipStr)) return false;
  return SERVICE_ALLOWED_CIDRS.some((cidr) => {
    try {
      return new CIDR(cidr).contains(ipStr);
    } catch {
      return false;
    }
  });
}

function validHmac(ts: string, sig: string): boolean {
  const now = Date.now();
  const age = Math.abs(now - Number(ts));
  if (Number.isNaN(Number(ts)) || age > HMAC_WINDOW_MS) return false;
  const expected = createHmac("sha256", SERVICE_API_KEY).update(ts).digest("hex");
  return timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
}

/**
 * Call at top of internal route handlers.
 * Returns a NextResponse on error, or nothing.
 */
export function requireInternalAuth(req: NextRequest): NextResponse | void {
  const apiKey = req.headers.get("x-api-key") ?? "";
  if (!apiKey) {
    return NextResponse.json({ error: "API key required" }, { status: 401 });
  }
  // timing-safe compare
  const keyBuf = Buffer.from(apiKey);
  const srvBuf = Buffer.from(SERVICE_API_KEY);
  if (keyBuf.length !== srvBuf.length || !timingSafeEqual(keyBuf, srvBuf)) {
    return NextResponse.json({ error: "Invalid API key" }, { status: 401 });
  }
  const ip = clientIp(req);
  if (!ipAllowed(ip)) {
    return NextResponse.json({ error: "IP not allowed" }, { status: 403 });
  }
  const ts = req.headers.get("x-timestamp") ?? "";
  const sig = req.headers.get("x-signature") ?? "";
  if (!ts || !sig || !validHmac(ts, sig)) {
    return NextResponse.json({ error: "Bad HMAC or timestamp" }, { status: 401 });
  }
  // authorized
}
