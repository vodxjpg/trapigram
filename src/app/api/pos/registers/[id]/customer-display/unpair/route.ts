import { NextRequest, NextResponse } from "next/server";
import { getContext } from "@/lib/context";
import { pgPool as pool } from "@/lib/db";

export const runtime = "nodejs";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { organizationId } = ctx;
  const { id } = await params;

  await pool.query(
    `UPDATE registers
        SET "displayPairCode"=NULL,
            "displayPairCodeExpiresAt"=NULL,
            "displaySessionId"=NULL,
            "displayPairedAt"=NULL
      WHERE id=$1 AND "organizationId"=$2`,
    [id, organizationId]
  );

  return NextResponse.json({ ok: true }, { status: 200 });
}
