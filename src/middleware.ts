import { NextRequest, NextResponse } from "next/server";
import { getSessionCookie } from "better-auth/cookies";

export async function middleware(request: NextRequest) {
  console.log("Middleware triggered for:", request.nextUrl.pathname);

  const sessionCookie = getSessionCookie(request);
  console.log("Session cookie:", sessionCookie);

  // Define public paths and check "/" as an exact match.
  const publicPaths = ["/", "/login", "/sign-up", "/forgot-password", "/verify-email"];
  const isPublicPath = publicPaths.some((path) =>
    path === "/" 
      ? request.nextUrl.pathname === "/" 
      : request.nextUrl.pathname.startsWith(path)
  );
  console.log("Is public path:", isPublicPath);

  if (!sessionCookie && !isPublicPath && request.nextUrl.pathname !== "/reset-password") {
    console.log("No session and not public, redirecting to /login");
    return NextResponse.redirect(new URL("/login", request.url));
  }

  if (request.nextUrl.pathname === "/reset-password") {
    const token = request.nextUrl.searchParams.get("token");
    if (!token) {
      console.log("No token for reset-password, redirecting to /forgot-password");
      return NextResponse.redirect(new URL("/forgot-password", request.url));
    }
    console.log("Reset-password with token, proceeding");
    return NextResponse.next();
  }

  if (!sessionCookie && isPublicPath) {
    console.log("No session but public path, proceeding");
    return NextResponse.next();
  }

  const checkStatusResponse = await fetch(
    new URL("/api/auth/check-status", request.url).toString(),
    { headers: request.headers }
  );
  const checkStatusData = await checkStatusResponse.json();
  console.log("Check-status response:", checkStatusData);

  if (!checkStatusResponse.ok) {
    console.error("Check-status failed:", checkStatusData);
    return NextResponse.redirect(new URL("/login", request.url));
  }

  const { redirect } = checkStatusData;
  console.log("Redirect target:", redirect);

  // Only redirect if redirect is non-null and different from the current path.
  if (redirect && request.nextUrl.pathname !== redirect) {
    console.log(`Redirecting from ${request.nextUrl.pathname} to ${redirect}`);
    return NextResponse.redirect(new URL(redirect, request.url));
  }

  console.log("Path matches redirect or no redirect needed, proceeding");
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
