/* src/app/api/token/route.ts  — COMPLETE file */
import { NextRequest, NextResponse } from "next/server";
import { sign as jwtSign } from "jsonwebtoken";
import { createHmac, timingSafeEqual } from "crypto";
import { loadKey } from "@/lib/readKey";
import CIDR from "ip-cidr";

let MASTER_KEY!: string;
let PRIVATE_KEY!: string;
let CIDRS: string[] = [];
let HMAC_WINDOW = 300_000;

function ensureEnv() {
  if (MASTER_KEY) return;

  MASTER_KEY  = process.env.SERVICE_API_KEY ?? "";
  HMAC_WINDOW = (Number(process.env.SERVICE_JWT_TTL) || 300) * 1_000;

  PRIVATE_KEY = loadKey(
    process.env.SERVICE_JWT_PRIVATE_KEY ?? process.env.SERVICE_JWT_PRIVATE_KEY_PATH,
  ).replace(/\\n/g, "\n").trim();

  CIDRS = (process.env.SERVICE_ALLOWED_CIDRS ?? "")
    .split(",").map(s => s.trim()).filter(Boolean);

  if (!MASTER_KEY || !PRIVATE_KEY || CIDRS.length === 0) {
    throw new Error(
      "SERVICE_API_KEY / SERVICE_JWT_PRIVATE_KEY(_PATH) / SERVICE_ALLOWED_CIDRS missing",
    );
  }
}

/* ────────────── IP helpers ───────────────── */
function toIPv4(raw: string) {
  if (raw === "::1") return "127.0.0.1";
  return raw.startsWith("::ffff:") ? raw.slice(7) : raw;
}

function ipToInt(ip: string) {
  return ip.split(".").reduce((n, o) => (n << 8) + +o, 0) >>> 0;
}

function cidrContains(ipStr: string, block: string) {
  if (!block.includes("/")) return ipStr === block;
  const [base, bitsStr] = block.split("/");
  const bits = Number(bitsStr);
  if (Number.isNaN(bits) || bits < 0 || bits > 32) return false;
  const mask = (0xffffffff << (32 - bits)) >>> 0;
  return (ipToInt(ipStr) & mask) === (ipToInt(base) & mask);
}

function ipAllowed(raw: string) {
  const ip = toIPv4(raw.trim());
  /* 1️⃣ fast-path via ip-cidr */
  for (const c of CIDRS) {
    try { if (new CIDR(c).contains(ip)) return true; }
    catch {/* fall through */}
  }
  /* 2️⃣ deterministic fallback */
  return CIDRS.some(c => cidrContains(ip, c));
}

function extractClientIp(req: NextRequest): string {
  const cf = req.headers.get("cf-connecting-ip");
  if (cf) return cf;
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return (req as any).ip || "";
}
/* ────────────── handler ───────────────── */
export async function POST(req: NextRequest) {
  ensureEnv();

  const ipRaw = extractClientIp(req);
  console.log("Client IP:", ipRaw);

  if (!ipAllowed(ipRaw)) {
    console.log(`IP ${ipRaw} not allowed; CIDRs: ${CIDRS.join()}`);
    return NextResponse.json({ error: "IP not allowed" }, { status: 403 });
  }

  const apiKey = req.headers.get("x-api-key") ?? "";
  if (apiKey !== MASTER_KEY) {
    return NextResponse.json({ error: "Invalid API key" }, { status: 401 });
  }

  const ts  = req.headers.get("x-timestamp") ?? "";
  const sig = req.headers.get("x-signature") ?? "";
  const age = Math.abs(Date.now() - Number(ts));
  if (!ts || !sig || age > HMAC_WINDOW) {
    return NextResponse.json({ error: "Bad timestamp" }, { status: 401 });
  }

  const expected = createHmac("sha256", MASTER_KEY).update(ts).digest("hex");
  if (!timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
    return NextResponse.json({ error: "Bad signature" }, { status: 401 });
  }

  try {
    const nowSec  = Math.floor(Date.now() / 1000);
    const expSec  = nowSec + Math.floor(HMAC_WINDOW / 1_000);
    const token   = jwtSign(
      { sub: "service-account", scope: "full", iat: nowSec, exp: expSec },
      PRIVATE_KEY,
      { algorithm: "RS256" },
    );
    return NextResponse.json({ token, expiresIn: expSec - nowSec });
  } catch (e: any) {
    return NextResponse.json({ error: `JWT signing failed: ${e.message}` }, { status: 500 });
  }
}
