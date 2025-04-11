// /home/zodx/Desktop/trapigram/src/middleware.ts

import { NextRequest, NextResponse } from "next/server";
import { getSessionCookie } from "better-auth/cookies";

export async function middleware(request: NextRequest) {
  console.log("Middleware triggered for:", request.nextUrl.pathname);

  const sessionCookie = getSessionCookie(request);
  console.log("Session cookie:", sessionCookie);

  // ---------------------------------------------------------
  // Define your public paths. Notice we have "/accept-invitation/:path*"
  // so that any dynamic route under "/accept-invitation/..." is allowed as public.
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
  const isPublicPath = publicPaths.some((path) =>
    path === "/"
      ? request.nextUrl.pathname === "/"
      : path.includes(":path*")
      ? request.nextUrl.pathname.startsWith(path.split(":")[0])
      : request.nextUrl.pathname.startsWith(path)
  );
  console.log("Is public path:", isPublicPath);

  // If there's NO session cookie and the path is NOT public, redirect to /login
  if (!sessionCookie && !isPublicPath && request.nextUrl.pathname !== "/reset-password") {
    console.log("No session and not public, redirecting to /login");
    return NextResponse.redirect(new URL("/login", request.url));
  }

  // Special handling for /reset-password
  if (request.nextUrl.pathname === "/reset-password") {
    const token = request.nextUrl.searchParams.get("token");
    if (!token) {
      console.log("No token for reset-password, redirecting to /forgot-password");
      return NextResponse.redirect(new URL("/forgot-password", request.url));
    }
    console.log("Reset-password with token, proceeding");
    return NextResponse.next();
  }

  // If no session cookie but path is public => just proceed
  if (!sessionCookie && isPublicPath) {
    console.log("No session but public path, proceeding");
    return NextResponse.next();
  }

  // ---------------------------------------------------------
  // We have a sessionCookie, or the path is protected, so we do the check-status:
  // IMPORTANT: pass the *original* path as a query param so we can detect
  // that it was "/accept-invitation/..." in check-status code.
  // ---------------------------------------------------------
  const originalPath = request.nextUrl.pathname;
  const checkStatusUrl = new URL("/api/auth/check-status", request.url);
  checkStatusUrl.searchParams.set("originalPath", originalPath);

  const checkStatusResponse = await fetch(checkStatusUrl, {
    headers: request.headers,
    // Pass along the same method/cookies if needed:
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

  // If checkStatus says to redirect, do it (unless we are already on that path)
  if (redirect && redirect !== originalPath) {
    console.log(`Redirecting from ${originalPath} to ${redirect}`);
    return NextResponse.redirect(new URL(redirect, request.url));
  }

  console.log("Path matches redirect or no redirect needed, proceeding");
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
