// src/middleware.ts
import { NextRequest, NextResponse } from "next/server";
import { getSessionCookie } from "better-auth/cookies";

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // ────────────────────────────────────────────────────────
  // 1) CORS for /api/* (preflight + real requests)
  // ────────────────────────────────────────────────────────
  if (pathname.startsWith("/api/")) {
    // Handle preflight
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin":      "https://trapyfy.com",
          "Access-Control-Allow-Methods":     "GET,POST,PUT,PATCH,DELETE,OPTIONS",
          "Access-Control-Allow-Headers":     "Content-Type,Authorization",
          "Access-Control-Allow-Credentials": "true",
          "Access-Control-Max-Age":           "86400",
        },
      });
    }

    // Attach CORS headers to real requests
    const res = NextResponse.next();
    res.headers.set("Access-Control-Allow-Origin",      "https://trapyfy.com");
    res.headers.set("Access-Control-Allow-Methods",     "GET,POST,PUT,PATCH,DELETE,OPTIONS");
    res.headers.set("Access-Control-Allow-Headers",     "Content-Type,Authorization");
    res.headers.set("Access-Control-Allow-Credentials", "true");
    return res;
  }

  // ────────────────────────────────────────────────────────
  // 2) Your existing auth middleware for non-API paths
  // ────────────────────────────────────────────────────────
  console.log("Middleware triggered for:", pathname);

  const sessionCookie = getSessionCookie(request);
  console.log("Session cookie:", sessionCookie);

  // Define your public paths
  const publicPaths = [
    "/",
    "/login",
    "/sign-up",
    "/forgot-password",
    "/verify-email",
    "/accept-invitation/:path*",
    "/check-email",
  ];
  const isPublicPath = publicPaths.some((path) =>
    path === "/"
      ? pathname === "/"
      : path.includes(":path*")
      ? pathname.startsWith(path.split(":")[0])
      : pathname.startsWith(path)
  );
  console.log("Is public path:", isPublicPath);

  if (isPublicPath) {
    console.log("Public path, proceeding without auth check");
    return NextResponse.next();
  }

  // Special handling for /reset-password
  if (pathname === "/reset-password") {
    const token = request.nextUrl.searchParams.get("token");
    if (!token) {
      console.log("No token for reset-password, redirecting to /forgot-password");
      return NextResponse.redirect(new URL("/forgot-password", request.url));
    }
    console.log("Reset-password with token, proceeding");
    return NextResponse.next();
  }

  // If no session cookie on protected path => redirect to /login
  if (!sessionCookie) {
    console.log("No session and not a public path, redirecting to /login");
    return NextResponse.redirect(new URL("/login", request.url));
  }

  // Check-status flow
  const originalPath = pathname;
  const checkStatusUrl = new URL("/api/auth/check-status", request.url);
  checkStatusUrl.searchParams.set("originalPath", originalPath);

  const checkStatusResponse = await fetch(checkStatusUrl, {
    headers: request.headers,
    method: "GET",
    credentials: "include",
  });
  const checkStatusData = await checkStatusResponse.json();
  console.log("Check-status response:", checkStatusData);

  if (!checkStatusResponse.ok) {
    console.error("Check-status failed:", checkStatusData);
    return NextResponse.redirect(new URL("/login", request.url));
  }

  const { redirect } = checkStatusData;
  console.log("Redirect target:", redirect);

  if (redirect && redirect !== originalPath) {
    console.log(`Redirecting from ${originalPath} to ${redirect}`);
    return NextResponse.redirect(new URL(redirect, request.url));
  }

  console.log("All checks passed => proceeding");
  return NextResponse.next();
}

export const config = {
  matcher: [
    // must include API so our CORS branch runs
    "/api/:path*",
    // keep your original non-API matcher
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
