// src/lib/internalAuth.ts
import { NextRequest, NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import net from "net";
import CIDR from "ip-cidr";

/** ─────────────────────────────────────────────────────────────
 *  Config
 *  - INTERNAL mode: single shared secret for intra-app calls
 *  - SERVICE mode : api key + HMAC + IP allow-list
 *  (Both can coexist; INTERNAL takes precedence if header present)
 *  ──────────────────────────────────────────────────────────── */
const INTERNAL_SECRET = process.env.INTERNAL_API_SECRET ?? "";

const SERVICE_API_KEY = process.env.SERVICE_API_KEY ?? "";
const SERVICE_ALLOWED_CIDRS = (process.env.SERVICE_ALLOWED_CIDRS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const HMAC_WINDOW_MS = (Number(process.env.SERVICE_JWT_TTL) || 300) * 1_000;

const HAVE_INTERNAL = Boolean(INTERNAL_SECRET);
const HAVE_SERVICE = Boolean(SERVICE_API_KEY && SERVICE_ALLOWED_CIDRS.length > 0);

if (!HAVE_INTERNAL) {
  console.warn("[internalAuth] INTERNAL_API_SECRET not set – x-internal-secret auth disabled.");
}
if (!HAVE_SERVICE) {
  console.warn("[internalAuth] SERVICE mode not fully configured – x-api-key/HMAC/IP auth may be unavailable.");
}

/** ─────────────────────────────────────────────────────────────
 * Helpers
 * ──────────────────────────────────────────────────────────── */
function clientIp(req: NextRequest): string {
  // Cloudflare
  const cf = req.headers.get("cf-connecting-ip");
  if (cf) return cf;
  // Generic proxy chain
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  // Fallback (may be empty on edge)
  return "";
}

function ipAllowed(ipStr: string): boolean {
  if (!HAVE_SERVICE) return false;
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

function safeEqual(a: string, b: string): boolean {
  const A = Buffer.from(a);
  const B = Buffer.from(b);
  return A.length === B.length && timingSafeEqual(A, B);
}

function validHmac(ts: string, sigHex: string): boolean {
  const now = Date.now();
  const tsNum = Number(ts);
  if (!Number.isFinite(tsNum)) return false;
  if (Math.abs(now - tsNum) > HMAC_WINDOW_MS) return false;

  const expected = createHmac("sha256", SERVICE_API_KEY).update(ts).digest("hex");
  return safeEqual(sigHex, expected);
}

/** ─────────────────────────────────────────────────────────────
 *  Main guard
 *  - returns NextResponse on error, or void on success
 * ──────────────────────────────────────────────────────────── */
export function requireInternalAuth(req: NextRequest): NextResponse | void {
  /** 1) INTERNAL SECRET PATH – fastest, preferred for same-app calls */
  const providedInternal = req.headers.get("x-internal-secret") ?? "";
  if (providedInternal) {
    if (!HAVE_INTERNAL) {
      return NextResponse.json(
        { error: "Internal secret auth disabled (INTERNAL_API_SECRET not set)" },
        { status: 401 }
      );
    }
    if (safeEqual(providedInternal, INTERNAL_SECRET)) {
      return; // ✅ authorized via internal secret
    }
    return NextResponse.json({ error: "Invalid internal secret" }, { status: 401 });
  }

  /** 2) SERVICE MODE PATH – API key + HMAC + IP allow-list */
  if (!HAVE_SERVICE) {
    return NextResponse.json(
      {
        error:
          "Unauthorized – supply x-internal-secret or configure service mode (SERVICE_API_KEY, SERVICE_ALLOWED_CIDRS).",
      },
      { status: 401 }
    );
  }

  const apiKey = req.headers.get("x-api-key") ?? "";
  if (!apiKey || !safeEqual(apiKey, SERVICE_API_KEY)) {
    return NextResponse.json({ error: "Invalid or missing API key" }, { status: 401 });
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

  return; // ✅ authorized via service mode
}
