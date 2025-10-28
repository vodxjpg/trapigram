import { NextRequest, NextResponse } from "next/server";
import { pgPool as pool } from "@/lib/db";

export async function GET(req: NextRequest) {
  const orgId = req.nextUrl.searchParams.get("organizationId");
  const limit = Number(req.nextUrl.searchParams.get("limit") ?? "10");
  if (!orgId) {
    return NextResponse.json({ error: "organizationId required" }, { status: 400 });
  }

  // Adjust table/column names if your schema differs.
  const sql = `
    SELECT c."userId", c.username, c."firstName", c."lastName",
           COALESCE(b."pointsCurrent",0) + COALESCE(b."pointsSpent",0) AS total
      FROM clients c
 LEFT JOIN "affiliatePointBalances" b
        ON b."clientId" = c.id
       AND b."organizationId" = c."organizationId"
     WHERE c."organizationId" = $1
       -- Exclude dropshipper-sourced clients for this organization
       AND (c.metadata->>'source') IS DISTINCT FROM 'dropshipper'
  ORDER BY total DESC NULLS LAST, c.username NULLS LAST, c."userId" ASC
     LIMIT $2
  `;
  try {
    const { rows } = await pool.query(sql, [orgId, limit]);
    return NextResponse.json({ leaderboard: rows });
  } catch (err) {
    console.error("[GET /affiliate/commands/leaderboard]", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
