// src/lib/verifyOrigin.ts
import { NextRequest } from "next/server";

/**
 * True ⇢ POST came from our own frontend (same-site origin).
 * Protects state-changing routes against CSRF.
 */
const allowedOrigins = [
  process.env.NEXT_PUBLIC_BASE_URL,
  process.env.NEXT_PUBLIC_APP_URL,
].filter(Boolean) as string[];

/**
 * True ⇢ POST came from our own frontend (same-site origin).
 */
export function verifyInternalPost(req: NextRequest): boolean {
  if (req.method !== "POST") return false;
  const origin = req.headers.get("origin") || "";
  return allowedOrigins.some((base) => origin.startsWith(base));
}

/**
 * True ⇢ GET came from our own frontend (same-site origin) or no Origin header.
 * Protects read-only endpoints from third-party requests.
 */
export function verifyAllowedOrigin(req: NextRequest): boolean {
  if (req.method !== "GET") return false;
  const origin = req.headers.get("origin");
  // No Origin header (e.g. direct navigation or SSR) ⇒ allow
  if (!origin) {
    return true;
  }
  // Exact same origin as the request URL
  const url = new URL(req.url);
  const sameOrigin = origin === `${url.protocol}//${url.host}`;
  if (sameOrigin) {
    return true;
  }
  // Otherwise fall back to allowedOrigins list
  return allowedOrigins.some((base) => origin.startsWith(base));
}
