// src/lib/upstash.ts
import { Redis } from "@upstash/redis/cloudflare";

export const redis = new Redis({
  url:   process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

/**
 * Create a pre‑signed SSE URL for one channel, valid N seconds
 */
export function signedSseURL(channel: string, ttlSec = 3600) {
  return redis.sse.subscribeUrl(channel, { expiresIn: ttlSec });
}
