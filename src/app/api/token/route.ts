/*───────────────────────────────────────────────────────────────
  src/app/api/token/route.ts
  Mints a short-lived (RS256) “service-account” JWT
───────────────────────────────────────────────────────────────*/
import { NextRequest, NextResponse } from "next/server";
import { sign as jwtSign }           from "jsonwebtoken";
import { createHmac }                from "crypto";
import { loadKey }                   from "@/lib/readKey";

/*──────────────────── Lazy env bootstrap ────────────────────*/
let MASTER_KEY!:  string;                // SERVICE_API_KEY
let PRIVATE_KEY!: string;                // RSA-PEM (inline or file)
let CIDRS:        string[] = [];         // allow-list
let HMAC_WINDOW   = 300_000;             // ms (default 300 s)

function ensureEnv() {
  if (MASTER_KEY) return;                // already initialised

  MASTER_KEY  = process.env.SERVICE_API_KEY ?? "";
  HMAC_WINDOW = (Number(process.env.SERVICE_JWT_TTL) || 300) * 1_000;

  /* ■ 1.  Private key  (path OR inline PEM) */
  PRIVATE_KEY = loadKey(
    process.env.SERVICE_JWT_PRIVATE_KEY ??
    process.env.SERVICE_JWT_PRIVATE_KEY_PATH,
  );
  // convert “\n” sequences to real new-lines if the key
  // came straight from an .env file:
  if (PRIVATE_KEY.includes("\\n")) {
    PRIVATE_KEY = PRIVATE_KEY.replace(/\\n/g, "\n").trim();
  }

  /* ■ 2.  CIDR / IP allow-list */
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

/*──────────────────── IP helpers ────────────────────*/
function toIPv4(raw: string) {
  if (raw === "::1")            return "127.0.0.1";          // v6 localhost
  if (raw.startsWith("::ffff:")) return raw.slice(7);        // v4-mapped v6
  return raw;
}
function ipToInt(ip: string) {
  return ip.split(".").reduce((n, o) => (n << 8) + +o, 0) >>> 0;
}
function cidrMatch(ip: string, cidr: string) {
  if (!cidr.includes("/")) return ip === cidr;
  const [base, bits] = cidr.split("/");
  const mask = -1 >>> (32 - Number(bits));
  return (ipToInt(ip) & mask) === (ipToInt(base) & mask);
}
function ipAllowed(raw: string) {
  const ip = toIPv4(raw);
  return CIDRS.some(c => cidrMatch(ip, c));
}

/*──────────────────── POST /api/token ────────────────────*/
export async function POST(req: NextRequest) {
  ensureEnv();                                          // initialise once

  /* 1)  IP gate ------------------------------------------------------*/
  const ipRaw =
    req.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
    // @ts-expect-error — present in Node runtime
    (req as any).ip ||
    "";

  if (!ipAllowed(ipRaw)) {
    return NextResponse.json({ error: "IP not allowed" }, { status: 403 });
  }

  /* 2)  Master API-key ----------------------------------------------*/
  if (req.headers.get("x-api-key") !== MASTER_KEY) {
    return NextResponse.json({ error: "Invalid API key" }, { status: 401 });
  }

  /* 3)  HMAC replay-protection --------------------------------------*/
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

  /* 4)  Issue JWT ----------------------------------------------------*/
  const expiresSec = Math.floor(HMAC_WINDOW / 1_000);   // e.g. 300
  const token = jwtSign(
    { sub: "service-account", scope: "full" },
    PRIVATE_KEY,                                       // ✓ now valid PEM
    { algorithm: "RS256", expiresIn: expiresSec },
  );

  return NextResponse.json({ token, expiresIn: expiresSec });
}
