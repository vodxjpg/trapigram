/*──────────────────────────────────────────────────────────────────
  src/app/api/token/route.ts   (NEW – mint 300 s RS256 JWT)
──────────────────────────────────────────────────────────────────*/
import { NextRequest, NextResponse } from "next/server";
import { sign as jwtSign } from "jsonwebtoken";
import { createHmac } from "crypto";
import net from "net";

const MASTER_KEY   = process.env.SERVICE_API_KEY ?? "";
const PRIVATE_KEY  = process.env.SERVICE_JWT_PRIVATE_KEY ?? "";
const CIDRS        = (process.env.SERVICE_ALLOWED_CIDRS ?? "")
  .split(",").map(s => s.trim()).filter(Boolean);
const HMAC_WINDOW  = 300_000; // 300 s

if (!MASTER_KEY || !PRIVATE_KEY || CIDRS.length === 0) {
  throw new Error("Service-token route mis-configured env vars");
}

/* simple /32 matcher (same as in context.ts) */
function ipAllowed(ip: string) {
  return CIDRS.some(c => c.endsWith("/32") ? c.slice(0, -3) === ip : c === ip);
}

export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
             (req as any).ip || "";
  if (!ipAllowed(ip)) {
    return NextResponse.json({ error: "IP not allowed" }, { status: 403 });
  }

  const apiKey = req.headers.get("x-api-key") ?? "";
  if (apiKey !== MASTER_KEY) {
    return NextResponse.json({ error: "Invalid API key" }, { status: 401 });
  }
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

  const token = jwtSign(
    { sub: "service-account", scope: "full" },
    PRIVATE_KEY,
    { algorithm: "RS256", expiresIn: 300 },   // 300 s
  );

  return NextResponse.json({ token, expiresIn: 300 });
}
