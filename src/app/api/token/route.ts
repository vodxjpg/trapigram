/* src/app/api/token/route.ts */
import { NextRequest, NextResponse } from "next/server";
import { sign as jwtSign } from "jsonwebtoken";
import { createHmac, timingSafeEqual } from "crypto";
import { loadKey } from "@/lib/readKey";

let MASTER_KEY!: string;
let PRIVATE_KEY!: string;
let CIDRS: string[] = [];
let HMAC_WINDOW = 300_000;

function ensureEnv() {
  if (MASTER_KEY) return;

  MASTER_KEY = process.env.SERVICE_API_KEY ?? "";
  HMAC_WINDOW = (Number(process.env.SERVICE_JWT_TTL) || 300) * 1_000;
  console.log("HMAC_WINDOW (ms):", HMAC_WINDOW);

  PRIVATE_KEY = loadKey(
    process.env.SERVICE_JWT_PRIVATE_KEY ?? process.env.SERVICE_JWT_PRIVATE_KEY_PATH
  );
  if (PRIVATE_KEY.includes("\\n")) {
    PRIVATE_KEY = PRIVATE_KEY.replace(/\\n/g, "\n").trim();
  }
  console.log("PRIVATE_KEY (first 50 chars):", PRIVATE_KEY.slice(0, 50) + "...");
  console.log("PRIVATE_KEY is PEM format:", PRIVATE_KEY.includes("-----BEGIN PRIVATE KEY-----"));

  CIDRS = (process.env.SERVICE_ALLOWED_CIDRS ?? "")
    .split(",")
    .map(s => s.trim())
    .filter(Boolean);

  if (!MASTER_KEY || !PRIVATE_KEY || CIDRS.length === 0) {
    throw new Error(
      "SERVICE_API_KEY / SERVICE_JWT_PRIVATE_KEY(_PATH) / SERVICE_ALLOWED_CIDRS missing"
    );
  }
}

function toIPv4(raw: string) {
  if (raw === "::1") return "127.0.0.1";
  if (raw.startsWith("::ffff:")) return raw.slice(7);
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

export async function POST(req: NextRequest) {
  ensureEnv();

  const ipRaw =
    req.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
    (req as any).ip ||
    "";
  console.log("IP received:", ipRaw);

  if (!ipAllowed(ipRaw)) {
    console.log(`IP ${ipRaw} not allowed; allowed CIDRs: ${CIDRS}`);
    return NextResponse.json({ error: "IP not allowed" }, { status: 403 });
  }

  const apiKey = req.headers.get("x-api-key") ?? "";
  if (apiKey !== MASTER_KEY) {
    console.log("Invalid API key");
    return NextResponse.json({ error: "Invalid API key" }, { status: 401 });
  }

  const ts = req.headers.get("x-timestamp") ?? "";
  const sig = req.headers.get("x-signature") ?? "";
  const age = Math.abs(Date.now() - Number(ts));

  console.log(`Timestamp: ${ts}, Signature: ${sig}, Age: ${age}ms`);

  if (!ts || !sig || age > HMAC_WINDOW) {
    console.log(`Bad timestamp: age=${age}ms, window=${HMAC_WINDOW}ms`);
    return NextResponse.json({ error: "Bad timestamp" }, { status: 401 });
  }

  const expected = createHmac("sha256", MASTER_KEY).update(ts).digest("hex");
  if (!timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
    console.log(`HMAC mismatch: expected=${expected}, received=${sig}`);
    return NextResponse.json({ error: "Bad signature" }, { status: 401 });
  }

  try {
    const expiresSec = Math.floor(HMAC_WINDOW / 1_000);
    const payload = {
      sub: "service-account",
      scope: "full",
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + expiresSec,
    };
    console.log("Signing JWT with payload:", payload);
    const token = jwtSign(payload, PRIVATE_KEY, { algorithm: "RS256" });
    console.log("Generated JWT:", token.slice(0, 20) + "...");
    return NextResponse.json({ token, expiresIn: expiresSec });
  } catch (e) {
    console.error("JWT signing failed:", e.message);
    return NextResponse.json({ error: `JWT signing failed: ${e.message}` }, { status: 500 });
  }
}