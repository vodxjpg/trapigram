// src/lib/rateLimiter.ts
import { RateLimiterMemory } from "rate-limiter-flexible";
import { NextRequest, NextResponse } from "next/server";

/* ─────────── Tunables via env (safe defaults) ─────────── */
const GLOBAL_POINTS   = Number(process.env.RATE_LIMIT_GLOBAL_POINTS   ?? 600);  // normal
const GLOBAL_DURATION = Number(process.env.RATE_LIMIT_GLOBAL_DURATION ?? 60);
const HEAVY_POINTS    = Number(process.env.RATE_LIMIT_HEAVY_POINTS    ?? 60);   // writes/heavy
const HEAVY_DURATION  = Number(process.env.RATE_LIMIT_HEAVY_DURATION  ?? 60);
const BOT_POINTS      = Number(process.env.RATE_LIMIT_BOT_POINTS      ?? 9000); // internal bot
const BOT_DURATION    = Number(process.env.RATE_LIMIT_BOT_DURATION    ?? 60);

/* ─────────── Buckets ─────────── */
export const globalLimiter = new RateLimiterMemory({
  points: GLOBAL_POINTS,
  duration: GLOBAL_DURATION,
});

export const heavyLimiter = new RateLimiterMemory({
  points: HEAVY_POINTS,
  duration: HEAVY_DURATION,
});

export const botLimiter = new RateLimiterMemory({
  points: BOT_POINTS,
  duration: BOT_DURATION,
});

/* ─────────── Helpers ─────────── */
function ipFromHeaders(req: NextRequest): string {
  const cf = req.headers.get("cf-connecting-ip");
  if (cf) return cf;
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return (req as any).ip || "unknown";
}

function getRateLimitKey(req: NextRequest, ipOverride?: string) {
  const org = req.nextUrl.searchParams.get("organizationId");
  if (org) return `org:${org}`;

  const apiKey = req.headers.get("x-api-key");
  if (apiKey) return `api:${apiKey}`;

  const ip = ipOverride || ipFromHeaders(req);
  return `ip:${ip}`;
}

function isHeavyPath(req: NextRequest) {
  // treat non-GETs as heavy + a few expensive reads
  if (req.method !== "GET") return true;
  const p = req.nextUrl.pathname;
  return /\/api\/(order|cart|import|products\/bulk)/.test(p);
}

function isPlatformBot(req: NextRequest) {
  const platform = req.headers.get("x-platform-key");
  const ua = req.headers.get("user-agent") || "";
  const botHdr = req.headers.get("x-bot-service");
  return (
    !!platform &&
    platform === process.env.SERVICE_API_KEY &&
    (botHdr === "1" || /bot_service/i.test(ua))
  );
}

/**
 * Consume one point from the appropriate limiter.
 * Throws NextResponse(429) with Retry-After on violation.
 */
export async function enforceRateLimit(req: NextRequest, ipOverride?: string) {
  const key = getRateLimitKey(req, ipOverride);
  const heavy = isHeavyPath(req);
  const bot = isPlatformBot(req);

  try {
    if (bot) {
      await botLimiter.consume(key);
      return;
    }
    if (heavy) {
      await heavyLimiter.consume(key);
    } else {
      await globalLimiter.consume(key);
    }
  } catch (err: any) {
    const ms = Math.max(1000, Number(err?.msBeforeNext ?? 0));
    const retry = Math.ceil(ms / 1000);
    throw new NextResponse(
      JSON.stringify({ error: "Too Many Requests", retryAfter: retry }),
      {
        status: 429,
        headers: {
          "Content-Type": "application/json",
          "Retry-After": String(retry),
        },
      }
    );
  }
}
