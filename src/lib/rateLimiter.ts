// src/lib/rateLimiter.ts
import { RateLimiterMemory } from 'rate-limiter-flexible';
import { NextRequest, NextResponse } from 'next/server';

// 100 req / 60s for most endpoints
export const globalLimiter = new RateLimiterMemory({
  points: 5,
  duration: 60,
});

// 20 req / 60s for “heavy” endpoints
export const heavyLimiter = new RateLimiterMemory({
  points: 20,
  duration: 60,
});

function getRateLimitKey(req: NextRequest) {
  const org = req.nextUrl.searchParams.get('organizationId');
  if (org) return org;
  const apiKey = req.headers.get('x-api-key');
  if (apiKey) return apiKey;
  return req.ip;
}

/**
 * Consumes one point from the appropriate limiter.
 * Throws NextResponse(429) if limit exceeded.
 */
export async function enforceRateLimit(req: NextRequest) {
  const key = getRateLimitKey(req);

  // If you have specific “heavy” paths, match them:
  const isHeavy = req.nextUrl.pathname.startsWith('/api/heavy');

  try {
    if (isHeavy) {
      await heavyLimiter.consume(key);
    } else {
      await globalLimiter.consume(key);
    }
  } catch (_err) {
    throw new NextResponse('Too Many Requests', { status: 429 });
  }
}
