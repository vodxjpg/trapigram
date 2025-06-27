import { NextRequest, NextResponse } from "next/server";
import { pgPool as pool } from "@/lib/db";;
import { getContext } from "@/lib/context";



export async function GET(req: NextRequest) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { organizationId } = ctx;

  const { searchParams } = new URL(req.url);
  const userId = searchParams.get("userId");
  const platform = (searchParams.get("platform") ?? "telegram").toLowerCase();
  const botHandle = searchParams.get("botHandle");

  if (!userId) {
    return NextResponse.json({ error: "userId query parameter is required" }, { status: 400 });
  }

  const clientRes = await pool.query(
    `SELECT id FROM clients WHERE "organizationId" = $1 AND "userId" = $2`,
    [organizationId, userId]
  );
  if (clientRes.rowCount === 0) {
    return NextResponse.json({ error: "Affiliate client not found" }, { status: 404 });
  }
  const clientId = clientRes.rows[0].id;

  let link: string;
  switch (platform) {
    case "telegram": {
      const handle = botHandle || process.env.TELEGRAM_BOT_HANDLE!;
      const payload = encodeURIComponent(clientId); // Changed to just clientId
      link = `https://t.me/${handle}?start=${payload}`;
      break;
    }
    case "whatsapp": {
      return NextResponse.json({ error: "WhatsApp not yet implemented" }, { status: 501 });
    }
    default:
      return NextResponse.json({ error: "Unsupported platform" }, { status: 400 });
  }

  return NextResponse.json({ link });
}