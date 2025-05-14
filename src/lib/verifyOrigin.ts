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

export function verifyInternalPost(req: NextRequest): boolean {
  if (req.method !== "POST") return false;
  const origin = req.headers.get("origin") || "";
  return allowedOrigins.some((base) => origin.startsWith(base));
}
