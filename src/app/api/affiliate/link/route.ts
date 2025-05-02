import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";

const INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET as string;

/**
 * GET /api/affiliate/link?userId=…&platform=telegram|whatsapp
 *
 * Returns { link: "…" } – a ready‑to‑share referral URL.
 * Action is read‑only; no DB access required.
 */
export async function GET(req: NextRequest) {
  const apiKey = req.headers.get("x-api-key");
  const internalSecret = req.headers.get("x-internal-secret");
  const { searchParams } = new URL(req.url);
  const userId = searchParams.get("userId");
  const platform = (searchParams.get("platform") ?? "telegram").toLowerCase();

  if (!userId) {
    return NextResponse.json({ error: "userId query parameter is required" }, { status: 400 });
  }

  // Basic auth (same contract as other affiliate endpoints)
  if (apiKey) {
    const { valid, error } = await auth.api.verifyApiKey({ body: { key: apiKey } });
    if (!valid)
      return NextResponse.json({ error: error?.message || "Invalid API key" }, { status: 401 });
  } else if (internalSecret !== INTERNAL_API_SECRET) {
    return NextResponse.json(
      { error: "Unauthorized: Provide either an API key or internal secret" },
      { status: 403 },
    );
  }

  let link: string;
  switch (platform) {
    case "telegram": {
      // Example: https://t.me/ourbot?start=shared:<userId>
      const TELEGRAM_BOT_HANDLE = process.env.TELEGRAM_BOT_HANDLE || "ourbot";
      link = `https://t.me/${TELEGRAM_BOT_HANDLE}?start=shared:${userId}`;
      break;
    }
    case "whatsapp": {
      const msg = encodeURIComponent(
        `Join me on Trapigram using my referral link: https://app.trapigram.com/signup?ref=${userId}`,
      );
      link = `https://wa.me/?text=${msg}`;
      break;
    }
    default:
      return NextResponse.json({ error: "Unsupported platform" }, { status: 400 });
  }

  return NextResponse.json({ link });
}
