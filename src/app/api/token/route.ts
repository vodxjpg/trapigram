/*───────────────────────────────────────────────────────────────
  src/app/api/token/route.ts
  Mint a short-lived (RS256) “service-account” JWT
───────────────────────────────────────────────────────────────*/
import { NextRequest, NextResponse } from "next/server";
import { sign as jwtSign }           from "jsonwebtoken";
import { createHmac }                from "crypto";
import fs   from "fs";
import path from "path";
import { loadKey } from "@/lib/readKey";

/*──────────────────── Lazy env initialisation ───────────────*/
let MASTER_KEY  : string;
let PRIVATE_KEY : string;
let CIDRS       : string[];
let HMAC_WINDOW = 300_000;          // 300 s default

function ensureEnv() {
  if (MASTER_KEY) return;           // already loaded

  MASTER_KEY   = process.env.SERVICE_API_KEY ?? "";
  HMAC_WINDOW  = (Number(process.env.SERVICE_JWT_TTL) || 300) * 1_000;

  /* ── private key: prefer file path ──*/
   /* ── private key (inline or path) ──*/
 PRIVATE_KEY = loadKey(
   process.env.SERVICE_JWT_PRIVATE_KEY
     ?? process.env.SERVICE_JWT_PRIVATE_KEY_PATH,
 );

  /* ── allow-list CIDRs ──*/
  CIDRS = (process.env.SERVICE_ALLOWED_CIDRS ?? "")
            .split(",")
            .map(s => s.trim())
            .filter(Boolean);

  if (!MASTER_KEY || !PRIVATE_KEY || CIDRS.length === 0) {
    throw new Error(
      "SERVICE_API_KEY / SERVICE_JWT_PRIVATE_KEY(_PATH) / SERVICE_ALLOWED_CIDRS missing",
    );
  }
}

/* /32 matcher (same logic used in context.ts) */
function ipAllowed(ip: string) {
  return CIDRS.some(c =>
    c.endsWith("/32") ? c.slice(0, -3) === ip : c === ip,
  );
}

/*──────────────────── POST /api/token ────────────────────*/
export async function POST(req: NextRequest) {
  ensureEnv();                              // ← lazy load / validate

  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
    // @ts-ignore – Edge vs Node runtime difference
    (req as any).ip ||
    "";

  if (!ipAllowed(ip)) {
    return NextResponse.json({ error: "IP not allowed" }, { status: 403 });
  }

  const apiKey = req.headers.get("x-api-key") ?? "";
  if (apiKey !== MASTER_KEY) {
    return NextResponse.json({ error: "Invalid API key" }, { status: 401 });
  }

  /*── HMAC replay-protection ──*/
  const ts  = req.headers.get("x-timestamp")  ?? "";
  const sig = req.headers.get("x-signature")  ?? "";
  const age = Math.abs(Date.now() - Number(ts));
  if (!ts || !sig || age > HMAC_WINDOW) {
    return NextResponse.json({ error: "Bad timestamp" }, { status: 401 });
  }
  const expected = createHmac("sha256", MASTER_KEY).update(ts).digest("hex");
  if (sig !== expected) {
    return NextResponse.json({ error: "Bad signature" }, { status: 401 });
  }

  /*── Issue JWT ──*/
  const expiresSec = HMAC_WINDOW / 1_000;      // e.g. 300
  const token = jwtSign(
    { sub: "service-account", scope: "full" },
    PRIVATE_KEY,
    { algorithm: "RS256", expiresIn: expiresSec },
  );

  return NextResponse.json({ token, expiresIn: expiresSec });
}
