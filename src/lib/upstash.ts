// src/lib/upstash.ts
/**
 * Build a pre‑signed SSE URL that can be opened safely in the browser
 * (no Authorization header required).
 *
 * Upstash format:
 *   https://<rest‑url>/sse/<TOKEN>?topic=<channel>
 */
const REST  = process.env.UPSTASH_REDIS_REST_URL!;
const TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN!;

export function signedSseURL(channel: string): string {
  if (!REST || !TOKEN) throw new Error("Upstash env vars missing");
  const base = REST.replace(/\/$/, "");          // strip trailing /
  return `${base}/sse/${TOKEN}?topic=${encodeURIComponent(channel)}`;
}
