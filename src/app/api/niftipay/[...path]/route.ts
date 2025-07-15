// app/api/niftipay/[...path]/route.ts
import { NextRequest, NextResponse } from "next/server";
const BASE = "https://www.niftipay.com/api";

function buildUpstream(req: NextRequest, path: string) {
  const { search } = new URL(req.url);
  const url = `${BASE}/${path}${search}`;

  const headers: Record<string,string> = {};
  req.headers.get("x-api-key") && (headers["x-api-key"] = req.headers.get("x-api-key")!);
  req.headers.get("cookie")     && (headers["cookie"]    = req.headers.get("cookie")!);

  return { url, headers };
}

export async function handler(
  req: NextRequest,
  { params }: { params: { path: string[] } },
) {
  const path     = params.path.join("/");
  const { url, headers } = buildUpstream(req, path);

  console.log("[NIFTI‑PROXY] →", req.method, url,
    "key:", headers["x-api-key"] ?? "NONE");

  // only these methods actually get a body
  const bodyMethods = new Set(["POST","PUT","PATCH"]);
  const init: RequestInit = {
    method:   req.method,
    headers,
    redirect: "manual",
  };

  if (bodyMethods.has(req.method)) {
    init.body   = req.body;
    // required in Edge for streamed bodies
    // (you can omit for non-streaming, but sae)
    (init as any).duplex = "half";
  }

  const upstream = await fetch(url, init);
  console.log("[NIFTI‑PROXY] ←", upstream.status, url);

  // fully read / decompress gzipped responses
  const text = await upstream.text();

  // strip content-encoding/length so browser can decode JSON
  const out = new Headers(upstream.headers);
  out.delete("content-encoding");
  out.delete("content-length");

  return new NextResponse(text, {
    status: upstream.status,
    headers: out,
  });
}

// wire up all verbs
export const GET     = handler;
export const POST    = handler;
export const PUT     = handler;
export const PATCH   = handler;
export const DELETE  = handler;
export const OPTIONS = handler;
