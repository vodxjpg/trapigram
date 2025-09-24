// src/lib/notifyBotService.ts
export async function notifyBotServicePlatformKeysChanged(organizationId: string) {
  const url = `${process.env.BOT_SERVICE_URL}/admin/platform-keys-changed`;
  const ts  = String(Math.floor(Date.now() / 1000));
  const key = process.env.SERVICE_API_KEY!;

  // HMAC(ts) — must match the bot's verification
  const sig = await (async () => {
    const enc = new TextEncoder();
    const cryptoKey = await crypto.subtle.importKey(
      "raw",
      enc.encode(key),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const mac = await crypto.subtle.sign("HMAC", cryptoKey, enc.encode(ts));
    return Array.from(new Uint8Array(mac)).map(b => b.toString(16).padStart(2, "0")).join("");
  })().catch(() => "");

  fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": key,
      "x-timestamp": ts,
      "x-signature": sig,
    },
    body: JSON.stringify({ organizationId }),
    keepalive: true, // fire-and-forget
  }).catch(() => {});
}