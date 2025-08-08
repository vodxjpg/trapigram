import { NextRequest, NextResponse } from "next/server";

const BASE =
  (process.env.NIFTIPAY_API_URL || "https://www.niftipay.com").replace(/\/+$/,"");

export async function GET(req: NextRequest) {
  const apiKey = req.headers.get("x-api-key");
  if (!apiKey) {
    return NextResponse.json({ error: "Missing x-api-key" }, { status: 400 });
  }

  const upstream = `${BASE}/api/payment-methods`;
  const ures = await fetch(upstream, { headers: { "x-api-key": apiKey } });

  // Pass through upstream status; normalize body to JSON
  const text = await ures.text();
  try {
    const json = JSON.parse(text);
    return NextResponse.json(json, { status: ures.status });
  } catch {
    return NextResponse.json(
      { error: "Bad upstream response", details: text.slice(0, 200) },
      { status: 502 }
    );
  }
}
