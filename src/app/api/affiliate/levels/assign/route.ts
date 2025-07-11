/* /src/app/api/affiliate/levels/assign/route.ts */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { pgPool as pool } from "@/lib/db";;
import { getContext } from "@/lib/context";



/*────────────── validation ──────────────*/
const bodySchema = z.object({
  clientId: z.string().min(1, "clientId required"),
});

/*────────────────────────────────────────*/
export async function POST(req: NextRequest) {
  /* organisation & auth checks */
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { organizationId } = ctx;

  /* 1️⃣ request body --------------------------------------------------*/
  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch (e: any) {
    const err = e instanceof z.ZodError ? e.errors : "Invalid JSON";
    return NextResponse.json({ error: err }, { status: 400 });
  }
  const { clientId } = body;

  try {
    /* 2️⃣ current & spent points  ------------------------------------*/
    const balRes = await pool.query(
      `SELECT "pointsCurrent", "pointsSpent"
         FROM "affiliatePointBalances"
        WHERE "organizationId" = $1 AND "clientId" = $2`,
      [organizationId, clientId],
    );

    const balRow = balRes.rows[0] ?? { pointsCurrent: 0, pointsSpent: 0 };

    let pointsCurrent = Number(balRow.pointsCurrent ?? 0);
    let pointsSpent = Number(balRow.pointsSpent ?? 0);

    /* sanitise – never let NaN/Infinity through */
    if (!Number.isFinite(pointsCurrent)) pointsCurrent = 0;
    if (!Number.isFinite(pointsSpent)) pointsSpent = 0;

    /* lifetime points decide the level */
    const lifetimePoints = pointsCurrent + pointsSpent;

    /* 3️⃣ best level for that total ----------------------------------*/
    const levelRes = await pool.query(
      `SELECT *
         FROM "affiliateLevels"
        WHERE "organizationId" = $1
          AND "requiredPoints" <= $2
     ORDER BY "requiredPoints" DESC
        LIMIT 1`,
      [organizationId, lifetimePoints],
    );

    const level = levelRes.rows[0] ?? null;
    const levelId = level ? level.id : null;

    /* 4️⃣ persist on client row --------------------------------------*/
    const { rows } = await pool.query(
      `UPDATE clients
          SET "levelId"   = $1,
              "updatedAt" = NOW()
        WHERE id = $2 AND "organizationId" = $3
        RETURNING *`,
      [levelId, clientId, organizationId],
    );

    if (!rows.length) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }

    /* 5️⃣ done -------------------------------------------------------*/
    return NextResponse.json({
      client: rows[0],
      assignedLevel: level,           // may be null
      balance: {
        pointsCurrent,
        pointsSpent,
        lifetimePoints,
      },
    });
  } catch (e) {
    console.error("[POST /api/affiliate/levels/assign]", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
