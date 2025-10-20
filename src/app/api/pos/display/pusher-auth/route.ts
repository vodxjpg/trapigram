import { NextRequest, NextResponse } from "next/server";
import { pusher } from "@/lib/pusher-server";
import { pgPool as pool } from "@/lib/db";

export const runtime = "nodejs";

// Pusher posts: {socket_id, channel_name}
// We'll also receive registerId & sessionId via auth.params
export async function POST(req: NextRequest) {
  const body = await req.formData(); // Pusher sends form-encoded by default
  const socketId = String(body.get("socket_id") || "");
  const channelName = String(body.get("channel_name") || "");
  const registerId = String(body.get("registerId") || "");
  const sessionId = String(body.get("sessionId") || "");

  if (!socketId || !channelName || !registerId || !sessionId) {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }

  // Validate that the session is current for this register
  const { rows } = await pool.query(
    `SELECT id FROM registers WHERE id=$1 AND "displaySessionId"=$2 LIMIT 1`,
    [registerId, sessionId]
  );
  if (!rows.length) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  // Channel must match our naming scheme
  const expected = `private-cd.${registerId}.${sessionId}`;
  if (channelName !== expected) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const auth = pusher.authorizeChannel(socketId, channelName);
  return NextResponse.json(auth, { status: 200 });
}
