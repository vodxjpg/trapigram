
// src/lib/upstash.ts        (NEW FILE)
import crypto from "crypto";

const BASE  = process.env.UPSTASH_REDIS_REST_URL!;   // e.g. https://eu1-magic.upstash.io
const TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN!; // your secret – never sent to browser

/**
 * Returns a short‑lived read‑only SSE URL for a given channel.
 * The browser can subscribe to it directly, but cannot write to Redis.
 *
 *   const url = signedSseURL("order:123", 900); // 15 min
 */
export function signedSseURL(channel: string, ttl = 900): string {
  if (!BASE || !TOKEN) throw new Error("Upstash env vars missing");

  const expire  = Math.floor(Date.now() / 1000) + ttl;      // unix sec
  const message = `${channel}:${expire}`;
  const sig     = crypto
    .createHmac("sha256", TOKEN)          // sign with your real token
    .update(message)
    .digest("hex");

  const u = new URL(BASE.replace(/\/$/, "") +  "/sse");      // …/sse
  u.searchParams.set("topic",     channel);
  u.searchParams.set("expire",    String(expire));
  u.searchParams.set("signature", sig);
  return u.toString();                                      // ready for EventSource
}
