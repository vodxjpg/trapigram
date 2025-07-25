// src/lib/pubsub.ts
/* Upstash Redis – minimal helper (no extra package install) */
const URL   = process.env.UPSTASH_REDIS_REST_URL!;
const TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN!;

/** Publish a stringified payload to a Redis channel. */
export async function publish(channel: string, message: string): Promise<void> {
  if (!URL || !TOKEN) {
    console.warn("[pubsub] Upstash env vars missing"); return;
  }
  await fetch(`${URL}/publish/${encodeURIComponent(channel)}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "text/plain",
    },
    body: message,
    cache: "no-store",
  });
}
