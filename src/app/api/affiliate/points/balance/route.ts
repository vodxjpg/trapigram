// NEW:  GET /api/affiliate/points/balance?id=<clientId>
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { pgPool as pool } from "@/lib/db";;
import { getContext } from "@/lib/context";



const qpSchema = z.object({ id: z.string().optional() });

export async function GET(req: NextRequest) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { organizationId } = ctx;

  const { id } = qpSchema.parse(
    Object.fromEntries(new URL(req.url).searchParams.entries()),
  );

  // single-client balance
  if (id) {
    const { rows } = await pool.query(
      `SELECT "pointsCurrent","pointsSpent"
         FROM "affiliatePointBalances"
        WHERE "organizationId" = $1 AND "clientId" = $2`,
      [organizationId, id],
    );
    return NextResponse.json(
      rows[0] ?? { pointsCurrent: 0, pointsSpent: 0 },
    );
  }

  // list all balances (cheap, but not needed by the bot right now)
  const { rows } = await pool.query(
    `SELECT "clientId","pointsCurrent","pointsSpent"
       FROM "affiliatePointBalances"
      WHERE "organizationId" = $1`,
    [organizationId],
  );
  return NextResponse.json({ balances: rows });
}
