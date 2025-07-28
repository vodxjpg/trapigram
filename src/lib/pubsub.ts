const URL = process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

/** Fire-and-forget publish – errors are swallowed (but logged) */
export async function publish(channel: string, payload: string) {
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
      body: JSON.stringify({ data: payload }), // Upstash expects {data:"…"}
    });
    if (!response.ok) {
      throw new Error(`Failed to publish: ${response.statusText}`);
    }
    console.log(`[pubsub] Published to channel ${channel}`);
  } catch (err) {
    console.error("[pubsub] Upstash publish failed:", err);
  }
}