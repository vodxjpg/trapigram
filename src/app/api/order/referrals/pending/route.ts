// src/app/api/order/referrals/pending/route.ts
import { NextRequest, NextResponse } from "next/server";
import { pgPool as pool } from "@/lib/db";
import { getContext } from "@/lib/context";

export async function GET(req: NextRequest) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { organizationId } = ctx;

  try {
    const sql = `
      SELECT
    o.id,
    o."clientId",
    o."orderKey",
    o.status,
    COALESCE(o."referralAwarded", FALSE) AS "referralAwarded",
    c."referredBy" AS "referredBy"
  FROM orders o
  JOIN clients c
    ON c.id = o."clientId"
  WHERE
    o."organizationId" = $1
    AND COALESCE(o."referralAwarded", FALSE) = FALSE
    AND o.status IN ('paid','completed')
    AND c."referredBy" IS NOT NULL
  ORDER BY o."updatedAt" DESC NULLS LAST, o."dateCreated" DESC
  LIMIT 500
    `;
    const { rows } = await pool.query(sql, [organizationId]);
    return NextResponse.json({ pending: rows }, { status: 200 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
