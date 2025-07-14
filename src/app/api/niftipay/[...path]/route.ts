// app/api/niftipay/[...path]/route.ts
import { NextRequest, NextResponse } from "next/server";

const BASE = "https://www.niftipay.com/api";

/* helper – build final URL and copy the two headers CoinX understands */
function build(req: NextRequest, path: string) {
  const { search } = new URL(req.url);
  const url = `${BASE}/${path}${search}`;

  const headers: Record<string, string> = {};
  const k = req.headers.get("x-api-key");
  if (k) headers["x-api-key"] = k;
  const c = req.headers.get("cookie");
  if (c) headers.cookie = c;

  return { url, headers };
}

/* single handler for **all** verbs */
export async function handler(
  req: NextRequest,
  { params }: { params: { path: string[] } },
) {
  const { url, headers } = build(req, params.path.join("/"));
  console.log(`[TPY] → ${req.method} ${url}`);

  const hasBody = !["GET", "HEAD", "OPTIONS"].includes(req.method);
  const upstream = await fetch(url, {
    method : req.method,
    headers,
    body   : hasBody ? req.body : undefined,
    redirect: "manual",
  });

  /* ---- unwrap gzip so the browser can .json() safely ---- */
  const raw     = await upstream.text();                 // already decompressed
  const outHead = new Headers(upstream.headers);
  outHead.delete("content-encoding");                    // no longer gzipped
  outHead.delete("content-length");                      // size changed

  return new NextResponse(raw, {
    status : upstream.status,
    headers: outHead,
  });
}

/* map every HTTP verb to the same handler */
export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const PATCH = handler;
export const DELETE = handler;
export const OPTIONS = handler;          // pre-flight
