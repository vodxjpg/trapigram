/**
 * Lightweight Upstash REST publisher for Server‑Sent Events
 *
 *   await publish("order:123", JSON.stringify(payload))
 */

const URL   = process.env.UPSTASH_REDIS_REST_URL!
const TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN!

/** Fire‑and‑forget publish – errors are swallowed (but logged) */
export async function publish(channel: string, payload: string) {
  if (!URL || !TOKEN) return                 // env not configured in dev
  try {
    await fetch(`${URL}/publish/${channel}`, {
      method:  "POST",
      cache:   "no-store",
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ data: payload }),   // 👈 Upstash expects {data:"…"}
    })
  } catch (err) {
    console.error("[pubsub] Upstash publish failed:", err)
  }
}
