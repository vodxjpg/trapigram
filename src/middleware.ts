// src/middleware.ts

import { NextRequest, NextResponse } from "next/server";
import { getSessionCookie } from "better-auth/cookies";

export async function middleware(request: NextRequest) {
  console.log("Middleware triggered for:", request.nextUrl.pathname);

  const sessionCookie = getSessionCookie(request);
  console.log("Session cookie:", sessionCookie);

  // ---------------------------------------------------------
  // Define your public paths. Any of these should always
  // be allowed through—even if a session cookie exists.
  // ---------------------------------------------------------
  const publicPaths = [
    "/",
    "/login",
    "/sign-up",
    "/forgot-password",
    "/verify-email",
    "/accept-invitation/:path*",
    "/check-email",
  ];
  const pathname = request.nextUrl.pathname;
  const isPublicPath = publicPaths.some((path) =>
    path === "/"
      ? pathname === "/"
      : path.includes(":path*")
      ? pathname.startsWith(path.split(":")[0])
      : pathname.startsWith(path)
  );
  console.log("Is public path:", isPublicPath);

  // Always allow public paths, regardless of session cookie
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

  // ---------------------------------------------------------
  // For any remaining (protected) path with a session cookie,
  // perform the /api/auth/check-status flow.
  // ---------------------------------------------------------
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

  // If checkStatus says to redirect (and it's not the same page), do it
  if (redirect && redirect !== originalPath) {
    console.log(`Redirecting from ${originalPath} to ${redirect}`);
    return NextResponse.redirect(new URL(redirect, request.url));
  }

  console.log("All checks passed => proceeding");
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
