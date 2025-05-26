/* /src/app/api/affiliate/link/route.ts */
import { NextRequest, NextResponse } from "next/server";
import { getContext } from "@/lib/context";

/**
 * GET /api/affiliate/link
 *        ?userId=<uuid>
 *        [&platform=telegram|whatsapp]
 *        [&botHandle=<telegram_bot_username>]
 *
 * Returns { link: "https://…"} – ready-to-share referral URL.
 * Auth is handled by getContext; no extra headers required.
 */
export async function GET(req: NextRequest) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;

  const { searchParams } = new URL(req.url);
  const userId    = searchParams.get("userId");
  const platform  = (searchParams.get("platform") ?? "telegram").toLowerCase();
  const botHandle = searchParams.get("botHandle"); // ⬅ override per-request

  if (!userId)
    return NextResponse.json({ error: "userId query parameter is required" }, { status: 400 });

  let link: string;
  switch (platform) {
    /*──────────────── Telegram ────────────────*/
    case "telegram": {
      const handle =
        botHandle ||
        process.env.TELEGRAM_BOT_HANDLE || // global default
        null;

      if (!handle)
        return NextResponse.json(
          { error: "botHandle query parameter or TELEGRAM_BOT_HANDLE env var is required" },
          { status: 400 },
        );

      // Format: https://t.me/<bot>?start=shared:<userId>
      link = `https://t.me/${handle}?start=shared:${userId}`;
      break;
    }

    /*──────────────── WhatsApp ────────────────*/
    case "whatsapp": {
      const msg = encodeURIComponent(
        `Join me on Trapigram using my referral link: https://app.trapigram.com/signup?ref=${userId}`,
      );
      link = `https://wa.me/?text=${msg}`;
      break;
    }

    /*──────────────── unsupported ─────────────*/
    default:
      return NextResponse.json({ error: "Unsupported platform" }, { status: 400 });
  }

  return NextResponse.json({ link });
}
