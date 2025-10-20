import { NextRequest, NextResponse } from "next/server";
import { getContext } from "@/lib/context";
import { pgPool as pool } from "@/lib/db";
import { randomInt } from "crypto";

export const runtime = "nodejs";

function makeCode() {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { organizationId } = ctx;
  const { id } = await params;

  const code = makeCode();
  const expires = new Date(Date.now() + 10 * 60 * 1000); // 10 min
  const accessKey = crypto.randomUUID();

  const { rows } = await pool.query(
    `UPDATE registers
        SET "displayActive"=TRUE,
            "displayPairCode"=$1,
            "displayPairCodeExpiresAt"=$2,
            "displayAccessKey"=COALESCE("displayAccessKey",$3),
            "displayPairedAt"=NULL,
            "displaySessionId"=NULL,
            "updatedAt"=NOW()
      WHERE id=$4 AND "organizationId"=$5
      RETURNING "displayAccessKey"`,
    [code, expires, accessKey, id, organizationId]
  );
  if (!rows.length) return NextResponse.json({ error: "Register not found" }, { status: 404 });

  const origin = process.env.NEXT_PUBLIC_APP_URL || new URL(req.url).origin;
  const portalUrl = `${origin}/pos/display?accessKey=${rows[0].displayaccesskey ?? accessKey}`;

  return NextResponse.json(
    { code, expiresAt: expires.toISOString(), portalUrl },
    { status: 200 }
  );
}
