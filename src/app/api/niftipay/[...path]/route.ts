// app/api/niftipay/[...path]/route.ts
import { NextRequest, NextResponse } from "next/server";

const BASE = "https://www.niftipay.com/api";

/* ────────────────────────────────────────────────────────────
   helper: build CoinX URL + copy headers we care about
──────────────────────────────────────────────────────────── */
function buildUpstream(req: NextRequest, path: string) {
  const { search } = new URL(req.url);                // keeps ?reference=…
  const url = `${BASE}/${path}${search}`;

  // pass only the two headers CoinX understands
  const headers: Record<string, string> = {};
  const apiKey = req.headers.get("x-api-key");
  if (apiKey) headers["x-api-key"] = apiKey;
  const cookie = req.headers.get("cookie");
  if (cookie) headers.cookie = cookie;

  return { url, headers };
}

/* ────────────────────────────────────────────────────────────
   generic handler – covers GET / POST / DELETE / PATCH …
──────────────────────────────────────────────────────────── */
export async function handler(
  req: NextRequest,
  {
    params,
  }: {
    params: { path: string[] };
  },
) {
  // 1) build URL + headers
  const { url, headers } = buildUpstream(req, params.path.join("/"));
  console.log(`[TPY] → ${req.method} ${url}`);

  // 2) stream body only for methods that may have one
  const hasBody = !["GET", "HEAD", "OPTIONS"].includes(req.method);
  const upstream = await fetch(url, {
    method : req.method,
    headers,
    body   : hasBody ? req.body : undefined,
    redirect: "manual",
  });

  // 3) mirror status, headers and body back to the browser
  const resHeaders = new Headers(upstream.headers);      // clone
  return new NextResponse(upstream.body, {
    status : upstream.status,
    headers: resHeaders,
  });
}

/*  Make Next 13/14 happy – map every verb to the same handler  */
export const GET     = handler;
export const POST    = handler;
export const PUT     = handler;
export const PATCH   = handler;
export const DELETE  = handler;
export const OPTIONS = handler;     // CORS pre-flight
