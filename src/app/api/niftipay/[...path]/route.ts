// app/api/niftipay/[...path]/route.ts
import { NextRequest, NextResponse } from "next/server";

const BASE = "https://www.niftipay.com/api";

export async function GET(
  req: NextRequest,
  { params }: { params: { path: string[] } },
) {
  const url  = `${BASE}/${params.path.join("/")}`;
  const resp = await fetch(url, { headers: { "x-api-key": req.headers.get("x-api-key") ?? "" } });

  return new NextResponse(resp.body, {
    status: resp.status,
    headers: {
      "Content-Type": resp.headers.get("content-type") ?? "application/json",
      // ✅ add your own Allow-Origin here; now your middleware will also append its CORS headers
    },
  });
}

export async function POST(
  req: NextRequest,
  { params }: { params: { path: string[] } },
) {
  const url  = `${BASE}/${params.path.join("/")}`;
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "x-api-key": req.headers.get("x-api-key") ?? "",
      "Content-Type": "application/json",
    },
    body: await req.text(),
  });

  return new NextResponse(resp.body, {
    status: resp.status,
    headers: { "Content-Type": resp.headers.get("content-type") ?? "application/json" },
  });
}
