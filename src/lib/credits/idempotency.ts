// src/lib/credits/idempotency.ts
import { NextRequest, NextResponse } from "next/server";

export function requireIdempotencyKey(req: NextRequest): [string, NextResponse | null] {
  const key = req.headers.get("idempotency-key") ?? "";
  if (!key || key.length < 6) {
    return ["", NextResponse.json({ error: "Missing Idempotency-Key header" }, { status: 400 })];
  }
  return [key, null];
}
