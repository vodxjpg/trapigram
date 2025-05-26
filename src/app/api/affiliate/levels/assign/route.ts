/* /src/app/api/affiliate/levels/assign/route.ts */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Pool } from "pg";
import { getContext } from "@/lib/context";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const bodySchema = z.object({
  clientId: z.string().min(1, "clientId required"),
});

export async function POST(req: NextRequest) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { organizationId } = ctx;

  /* 1️⃣ Validate body */
  let body;
  try {
    body = bodySchema.parse(await req.json());
  } catch (e: any) {
    if (e instanceof z.ZodError)
      return NextResponse.json({ error: e.errors }, { status: 400 });
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { clientId } = body;

  try {
    /* 2️⃣ Current balance */
    const {
      rows: [{ sum }],
    } = await pool.query(
      `SELECT COALESCE(SUM(points),0) FROM "affiliatePointLogs"
       WHERE "organizationId" = $1 AND "clientId" = $2`,
      [organizationId, clientId],
    );
    const balance = Number(sum);

    /* 3️⃣ Best level */
    const levelRes = await pool.query(
      `SELECT * FROM "affiliateLevels"
       WHERE "organizationId" = $1 AND "requiredPoints" <= $2
       ORDER BY "requiredPoints" DESC LIMIT 1`,
      [organizationId, balance],
    );
    const level = levelRes.rows[0] ?? null;
    const levelId = level ? level.id : null;

    /* 4️⃣ Update client */
    const { rows } = await pool.query(
      `UPDATE clients
       SET "levelId" = $1, "updatedAt" = NOW()
       WHERE id = $2 AND "organizationId" = $3
       RETURNING *`,
      [levelId, clientId, organizationId],
    );
    if (rows.length === 0)
      return NextResponse.json({ error: "Client not found" }, { status: 404 });

    return NextResponse.json({
      client: rows[0],
      assignedLevel: level,
      balance,
    });
  } catch (e) {
    console.error("[POST /api/affiliate/levels/assign]", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
