import { NextRequest, NextResponse } from "next/server";
import { pgPool as pool } from "@/lib/db";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const { code } = await req.json().catch(() => ({}));
  if (!code || String(code).length !== 6)
    return NextResponse.json({ error: "Invalid code" }, { status: 400 });

  const { rows } = await pool.query(
    `SELECT id, "organizationId", "displaySlides"
       FROM registers
      WHERE "displayActive"=TRUE
        AND "displayPairCode"=$1
        AND "displayPairCodeExpiresAt" > NOW()
      LIMIT 1`,
    [String(code)]
  );
  if (!rows.length) return NextResponse.json({ error: "Code expired or invalid" }, { status: 404 });

  const sessionId = crypto.randomUUID();
  await pool.query(
    `UPDATE registers
        SET "displayPairedAt"=NOW(),
            "displaySessionId"=$1
      WHERE id=$2`,
    [sessionId, rows[0].id]
  );

  return NextResponse.json(
    {
      ok: true,
      registerId: rows[0].id,
      sessionId,                // use on /stream
      slides: rows[0].displaySlides ?? [],
    },
    { status: 200 }
  );
}
