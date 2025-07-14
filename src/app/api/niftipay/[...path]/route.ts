// app/api/niftipay/[...path]/route.ts
import { NextRequest, NextResponse } from "next/server";

const BASE = "https://www.niftipay.com/api";

/* ───────────────────────── helpers ───────────────────────── */
function logReq(req: NextRequest, url: string) {
  const key = req.headers.get("x-api-key") ?? "∅";
  const cookie = req.headers.get("cookie") ?? "∅";
  console.log(`[TPY] → ${req.method} ${url}`);
  console.log("       x-api-key:", key.slice(0, 8) + "…" );
  console.log("       cookie   :", cookie ? "present" : "none");
}

/* ───────────────────────── GET ───────────────────────────── */
export async function GET(
  req: NextRequest,
  { params }: { params: { path: string[] } },
) {
  const url = `${BASE}/${params.path.join("/")}`;
  logReq(req, url);

  const resp = await fetch(url, {
    headers: {
      "x-api-key": req.headers.get("x-api-key") ?? "",
      // 🆕 forward the session cookie so the user is authenticated
      cookie      : req.headers.get("cookie") ?? "",
    },
  });

  return new NextResponse(resp.body, {
    status : resp.status,
    headers: {
      "Content-Type": resp.headers.get("content-type") ?? "application/json",
    },
  });
}

/* ───────────────────────── POST ──────────────────────────── */
export async function POST(
  req: NextRequest,
  { params }: { params: { path: string[] } },
) {
  const url = `${BASE}/${params.path.join("/")}`;
  logReq(req, url);

  const resp = await fetch(url, {
    method : "POST",
    headers: {
      "x-api-key": req.headers.get("x-api-key") ?? "",
      "Content-Type": "application/json",
      cookie: req.headers.get("cookie") ?? "",
    },
    body: await req.text(),
  });

  return new NextResponse(resp.body, {
    status : resp.status,
    headers: { "Content-Type": resp.headers.get("content-type") ?? "application/json" },
  });
}

/* ───────────────────────── DELETE ────────────────────────── */
// app/api/niftipay/[...path]/route.ts
export async function DELETE(
    req: NextRequest,
    { params }: { params: { path: string[] } },
  ) {
    const url = `${BASE}/${params.path.join("/")}${req.url.includes("?") ? "?" + req.url.split("?")[1] : ""}`;
    logReq(req, url);
  
    const apiKey = req.headers.get("x-api-key") ?? "";
    const cookie = req.headers.get("cookie") ?? "";
    console.log("[TPY] DELETE request headers sent to CoinX", {
      "x-api-key": apiKey ? apiKey.slice(0, 8) + "…" : "none",
      cookie: cookie ? "present" : "none",
    });
  
    const resp = await fetch(url, {
      method: "DELETE",
      headers: {
        "x-api-key": apiKey,
        cookie: cookie,
        "Content-Type": "application/json", // Add this to match POST
      },
    });
  
    const responseBody = await resp.text().catch(() => "Failed to read response body");
    console.log("[TPY] DELETE response from CoinX", {
      status: resp.status,
      headers: Object.fromEntries(resp.headers.entries()),
      body: responseBody,
    });
  
    return new NextResponse(resp.body, {
      status: resp.status,
      headers: { "Content-Type": resp.headers.get("content-type") ?? "application/json" },
    });
  }