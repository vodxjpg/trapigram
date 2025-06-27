import { NextRequest, NextResponse } from "next/server";
import { getSessionCookie }          from "better-auth/cookies";
import { enforceRateLimit }          from "@/lib/rateLimiter";

/*──────────────────── Config ────────────────────*/
const ALLOWED_ORIGINS = new Set([
  "https://trapyfy.com",
  "https://www.trapyfy.com",
]);

const CORS_ALLOW_HEADERS =
  "Content-Type,Authorization,x-api-key,x-timestamp,x-signature";
const CORS_ALLOW_METHODS = "GET,POST,PUT,PATCH,DELETE,OPTIONS";

/* helper – add the cors headers that browsers require */
function applyCorsHeaders(res: Response, origin: string) {
  if (!origin) return;
  res.headers.set("Access-Control-Allow-Origin", origin);
  res.headers.set("Access-Control-Allow-Credentials", "true");
  res.headers.set("Access-Control-Allow-Methods", CORS_ALLOW_METHODS);
  res.headers.set("Access-Control-Allow-Headers", CORS_ALLOW_HEADERS);
  res.headers.set("Vary", "Origin");
}

/* safest IP extractor for Vercel / CF → take **right-most** IP */
function clientIp(req: NextRequest) {
  const fwd = req.headers.get("x-forwarded-for");
  if (!fwd) return (req as any).ip ?? "";
  const ips = fwd.split(",").map(s => s.trim());
  return ips[ips.length - 1];           // first hop after the edge
}

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

    /* Rate-limit — if the limiter throws, decorate the 429 with CORS */
    try {
      await enforceRateLimit(req);
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
    2️⃣  Auth & onboarding for pages / assets
  ────────────────────────────────────────*/
  const pathLower = pathname.toLowerCase();

  const PUBLIC_PATHS = [
    "/", "/login", "/sign-up", "/forgot-password", "/verify-email",
    "/check-email", "/accept-invitation/",
  ];
  const isPublic = PUBLIC_PATHS.some(p =>
    p === "/"
      ? pathLower === "/"
      : p.endsWith("/")        /* prefix match */
        ? pathLower.startsWith(p)
        : pathLower === p,
  );
  if (isPublic) return NextResponse.next();

  /* /reset-password special-case */
  if (pathLower === "/reset-password") {
    if (!req.nextUrl.searchParams.get("token")) {
      return NextResponse.redirect(new URL("/forgot-password", req.url));
    }
    return NextResponse.next();
  }

  const sessionCookie = getSessionCookie(req);
  if (!sessionCookie) {
    return NextResponse.redirect(new URL("/login", req.url));
  }

  /* Call central policy endpoint */
  const checkUrl = new URL("/api/auth/check-status", req.url);
  checkUrl.searchParams.set("originalPath", pathname);

  const checkRes  = await fetch(checkUrl, {
    headers: req.headers,
    method : "GET",
    credentials: "include",
  });

  /* network / DB hiccup → let request through, client will retry */
  if (!checkRes.ok) return NextResponse.next();

  const { redirect } = await checkRes.json();
  if (redirect && redirect !== pathname) {
    return NextResponse.redirect(new URL(redirect, req.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/api/:path*", "/((?!_next/static|_next/image|favicon.ico).*)"],
};
