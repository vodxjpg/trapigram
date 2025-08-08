const URL = process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

export async function publish(channel: string, payload: object) {
  if (!URL || !TOKEN) {
    console.error("[pubsub] Upstash URL or TOKEN not configured");
    return;
  }
  try {
    const response = await fetch(`${URL}/publish/${channel}`, {
      method: "POST",
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload), // Send the object directly
    });
    if (!response.ok) {
      throw new Error(`Failed to publish: ${response.statusText}`);
    }
    console.log(`[pubsub] Published to channel ${channel}`);
  } catch (err) {
    console.error("[pubsub] Upstash publish failed:", err);
  }
}


/**
 * Push to a small, capped replay list and set TTL — using Upstash REST /pipeline.
 * Keeps `max` most recent items (default 50) for `ttlSeconds` (default 7 days).
 */
export async function lpushRecent(
  key: string,
  value: unknown,
  max = 50,
  ttlSeconds = 7 * 24 * 3600,
) {
  if (!URL || !TOKEN) {
    console.error("[pubsub] Upstash URL or TOKEN not configured");
    return;
  }
  const data = typeof value === "string" ? value : JSON.stringify(value);
  const body = JSON.stringify({
    commands: [
      ["LPUSH", key, data],
      ["LTRIM", key, "0", String(Math.max(0, max - 1))],
      ["EXPIRE", key, String(ttlSeconds)],
    ],
  });
  try {
    const res = await fetch(`${URL}/pipeline`, {
      method: "POST",
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        "Content-Type": "application/json",
      },
      body,
    });
    if (!res.ok) {
      throw new Error(`Failed pipeline: ${res.status} ${res.statusText}`);
    }
  } catch (err) {
    console.error("[pubsub] lpushRecent failed:", err);
  }
}
