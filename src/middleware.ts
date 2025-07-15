// middleware.ts  (FULL, HARDENED 2025-06-30)
import { NextRequest, NextResponse } from "next/server";
import { getSessionCookie }          from "better-auth/cookies";
import { enforceRateLimit }          from "@/lib/rateLimiter";

/*──────────────────── Config ────────────────────*/
const ALLOWED_ORIGINS = new Set([
  "https://trapyfy.com",
  "https://www.trapyfy.com",
  "https://www.niftipay.com",
]);

const CORS_ALLOW_HEADERS =
  "Content-Type,Authorization,x-api-key,x-timestamp,x-signature";
const CORS_ALLOW_METHODS = "GET,POST,PUT,PATCH,DELETE,OPTIONS";

/*──────────────────── Helpers ────────────────────*/
function applySecurityHeaders(res: Response) {
  res.headers.set("X-Content-Type-Options", "nosniff");
  res.headers.set("X-Frame-Options", "DENY");
  res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  res.headers.set("Cross-Origin-Resource-Policy", "same-origin");
  res.headers.set("Content-Security-Policy", "default-src 'self'");
  if (process.env.NODE_ENV === "production") {
    res.headers.set(
      "Strict-Transport-Security",
      "max-age=63072000; includeSubDomains; preload",
    );
  }
}

function applyCorsHeaders(res: Response, origin: string) {
  if (!origin) return;
  res.headers.set("Access-Control-Allow-Origin", origin);
  res.headers.set("Access-Control-Allow-Credentials", "true");
  res.headers.set("Access-Control-Allow-Methods", CORS_ALLOW_METHODS);
  res.headers.set("Access-Control-Allow-Headers", CORS_ALLOW_HEADERS);
  res.headers.set("Vary", "Origin");
  applySecurityHeaders(res);                     // piggy-back security headers
}

/* Resolve caller IP:
   • Cloudflare → CF-Connecting-IP
   • Vercel / others → x-forwarded-for first element
   • Fallback to req.ip  */
   function clientIp(req: NextRequest): string {
    const cf = req.headers.get("cf-connecting-ip");
    if (cf) return cf;
    const xff = req.headers.get("x-forwarded-for");
    if (xff) return xff.split(",")[0].trim();
    return (req as any).ip ?? "";
  }
  

/*──────────────────── Middleware ────────────────────*/
export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  /*────────────────────────────────────────
    1️⃣  CORS + rate-limit for /api/*
  ────────────────────────────────────────*/
  if (pathname.startsWith("/api/")) {
    const origin      = req.headers.get("origin") ?? "";
    const allowOrigin = ALLOWED_ORIGINS.has(origin) ? origin : "";

    /* Pre-flight */
    if (req.method === "OPTIONS") {
      const res = new Response(null, { status: 204 });
      applyCorsHeaders(res, allowOrigin);
      res.headers.set("Access-Control-Max-Age", "86400");
      return res;
    }

    /* Rate-limit */
    try {
      await enforceRateLimit(req, clientIp(req));   // pass resolved IP
    } catch (rateRes: any) {
      if (rateRes instanceof Response) {
        applyCorsHeaders(rateRes, allowOrigin);
        return rateRes;
      }
      throw rateRes;
    }

    /* Real request */
    const res = NextResponse.next();
    applyCorsHeaders(res, allowOrigin);
    return res;
  }

  /*────────────────────────────────────────
    2️⃣  Auth & public-page logic
  ────────────────────────────────────────*/
  const lower = pathname.toLowerCase();
  const PUBLIC = [
    "/", "/login", "/sign-up", "/forgot-password", "/verify-email",
    "/check-email", "/accept-invitation/", "/impor-products/", "/import-products"
  ];
  const isPublic = PUBLIC.some(p =>
    p === "/" ? lower === "/" : p.endsWith("/") ? lower.startsWith(p) : lower === p,
  );
  if (isPublic) return NextResponse.next();

  /* /reset-password must carry ?token= */
  if (lower === "/reset-password") {
    if (!req.nextUrl.searchParams.get("token")) {
      return NextResponse.redirect(new URL("/forgot-password", req.url));
    }
    return NextResponse.next();
  }

  /* Session required */
  if (!getSessionCookie(req)) {
    return NextResponse.redirect(new URL("/login", req.url));
  }

  /* Central policy check */
  const checkUrl = new URL("/api/auth/check-status", req.url);
  checkUrl.searchParams.set("originalPath", pathname);

  const policyRes = await fetch(checkUrl, {
    method: "GET",
    headers: req.headers,
    credentials: "include",
  });

  /* network / DB hiccup → allow */
  if (!policyRes.ok) return NextResponse.next();

  const { redirect } = await policyRes.json();
  if (redirect && redirect !== pathname) {
    return NextResponse.redirect(new URL(redirect, req.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/api/:path*", "/((?!_next/static|_next/image|favicon.ico).*)"],
};
