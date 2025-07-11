// src/app/api/reviews/summary/route.ts
import { NextRequest, NextResponse } from "next/server";
import { pgPool as pool } from "@/lib/db";;
import { getContext } from "@/lib/context";

// nothing
export async function GET(req: NextRequest) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { organizationId } = ctx;

  try {
    const sql = `
      SELECT
        COUNT(*)                                             AS total,
        SUM(CASE WHEN rate = 'positive' THEN 1 ELSE 0 END)   AS positive,
        SUM(CASE WHEN rate = 'neutral'  THEN 1 ELSE 0 END)   AS neutral,
        SUM(CASE WHEN rate = 'negative' THEN 1 ELSE 0 END)   AS negative
      FROM reviews
      WHERE "organizationId" = $1
    `;
    const { rows } = await pool.query(sql, [organizationId]);
    const { total, positive, neutral, negative } = rows[0];

    return NextResponse.json(
      {
        summary: {
          total: Number(total),
          positive: Number(positive),
          neutral: Number(neutral),
          negative: Number(negative),
        }
      },
      { status: 200 },
    );
  } catch (err) {
    console.error("[GET /api/reviews/summary] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
