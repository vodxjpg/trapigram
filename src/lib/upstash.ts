/**
 * Build a browser‑safe SSE URL for a single Redis channel.
 *
 * Usage:
 *   const url = sseURL("order:123");
 *
 * The URL embeds the Upstash REST token (read‑only), so the browser can
 * connect directly without any extra headers.  No HMAC signing is needed.
 */

const BASE  = process.env.UPSTASH_REDIS_REST_URL!;   // e.g. https://eu1-xxx.upstash.io
const TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN!; // the **REST** token (not the redis password)

/**
 * Returns a full `https://…/sse/<TOKEN>?topic=<channel>` URL
 * ready to be passed to `new EventSource(url)`.
 */
export function sseURL(channel: string): string {
  if (!BASE || !TOKEN) {
    throw new Error("Missing UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN");
  }

  // ensure no trailing slash on BASE
  const baseClean = BASE.replace(/\/$/, "");

  const u = new URL(`${baseClean}/sse/${encodeURIComponent(TOKEN)}`);
  u.searchParams.set("topic", channel);   // Upstash expects ?topic=<channel>
  return u.toString();
}
