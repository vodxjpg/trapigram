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
const BOT_BACKOFF_MS  = Number(process.env.RATE_LIMIT_BOT_BACKOFF_MS  ?? 1500); // max single wait
const SERVICE_API_KEY = process.env.SERVICE_API_KEY || ""
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
    // Accept either x-platform-key or x-api-key (same SERVICE_API_KEY),
  // plus a small identifying hint to avoid accidental matches.
  const platform = req.headers.get("x-platform-key");
  const ua = req.headers.get("user-agent") || "";
  const botHdr = req.headers.get("x-bot-service");
  const xApiKey = req.headers.get("x-api-key");
  const hasServiceKey =
    (!!platform && SERVICE_API_KEY && platform === SERVICE_API_KEY) ||
    (!!xApiKey  && SERVICE_API_KEY && xApiKey  === SERVICE_API_KEY);
  return hasServiceKey && (botHdr === "1" || /bot_service/i.test(ua));
}

function routeGroup(req: NextRequest): string {
  // Key bot limits by broad API area to avoid one shared bucket
  // e.g. /api/order/messages/receipt  → "order"
  //      /api/clients?page=...        → "clients"
  const p = req.nextUrl.pathname.replace(/^\/+/, "");
  const parts = p.split("/");
  return parts.length >= 2 && parts[0] === "api" ? parts[1] || "root" : "root";
}

function orgFromReq(req: NextRequest): string {
  return req.nextUrl.searchParams.get("organizationId") || "unknown";
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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
      // Bot: split by org + route-group; if bucket is empty, wait briefly and retry
      const key = `bot:${orgFromReq(req)}:${routeGroup(req)}`;
      try {
        await botLimiter.consume(key);
        return;
      } catch (err: any) {
        const wait = Math.min(
          BOT_BACKOFF_MS,
          Math.max(0, Number(err?.msBeforeNext ?? 0)),
        );
        if (wait > 0) {
          await sleep(wait);
          await botLimiter.consume(key); // second attempt after short backoff
          return;
        }
        throw err;
      }
    }
    // Non-bot: keep existing keys (org/api/ip) and buckets
    const key = getRateLimitKey(req, ipOverride);
    await (heavy ? heavyLimiter : globalLimiter).consume(key);
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
