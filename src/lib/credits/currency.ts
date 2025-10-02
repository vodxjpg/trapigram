// src/lib/credits/currency.ts
import { toMinorGBP } from "./calc";

/** Simple 120s in-memory cache to avoid excessive Currencylayer calls. */
let cacheUntil = 0;
let USDGBP = 0;
let USDEUR = 0;

async function fetchRates(): Promise<{ USDGBP: number; USDEUR: number }> {
  const key = process.env.CURRENCYLAYER_API_KEY;
  if (!key) throw new Error("CURRENCYLAYER_API_KEY is required");
  // currencylayer free plan uses USD as base; ask for GBP and EUR
  const res = await fetch(
    `https://api.currencylayer.com/live?access_key=${encodeURIComponent(
      key,
    )}&currencies=GBP,EUR`,
    { method: "GET", cache: "no-store" },
  );
  if (!res.ok) throw new Error(`Currencylayer error: ${res.status}`);
  const json = await res.json();
  if (!json?.success || !json?.quotes?.USDGBP || !json?.quotes?.USDEUR) {
    throw new Error("Currencylayer response missing USDGBP/USDEUR");
  }
  const g = Number(json.quotes.USDGBP);
  const e = Number(json.quotes.USDEUR);
  if (!Number.isFinite(g) || !Number.isFinite(e) || g <= 0 || e <= 0) {
    throw new Error("Invalid Currencylayer quotes");
  }
  return { USDGBP: g, USDEUR: e };
}

/** Convert an amount in currency → GBP minor units using Currencylayer (USD base).
 *  Supported: GBP (fast path), USD, EUR.
 *  EUR→GBP is computed via cross-rate: amount_EUR * (USDGBP / USDEUR).
 */
export async function toGBPMinor(amount: number, currency: string): Promise<number> {
  const cur = currency.toUpperCase();
  if (cur === "GBP") return toMinorGBP(amount);

  const now = Date.now();
  if (now > cacheUntil || USDGBP <= 0 || USDEUR <= 0) {
    const rates = await fetchRates();
    USDGBP = rates.USDGBP;
    USDEUR = rates.USDEUR;
    cacheUntil = now + 120_000; // 120s TTL
  }

  if (cur === "USD") {
    const gbp = amount * USDGBP; // USD * USDGBP
    return toMinorGBP(gbp);
  }

  if (cur === "EUR") {
    // EUR → GBP via USD base: EUR * (USDGBP / USDEUR)
    const gbp = amount * (USDGBP / USDEUR);
    return toMinorGBP(gbp);
  }

  throw new Error(
    `Unsupported currency "${currency}". Supported: GBP, USD, EUR (extend as needed).`,
  );
}
