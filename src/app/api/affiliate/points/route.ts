// src/app/api/affiliate/points/route.ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Pool } from "pg";
import { v4 as uuidv4 } from "uuid";
import { getContext } from "@/lib/context";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

/*──────── Schemas ────────*/
const pointCreateSchema = z.object({
  id: z.string().min(1, { message: "id is required." }),    // clientId
  points: z.number().int(),
  action: z.string().min(1),
  description: z.string().optional().nullable(),
  sourceId: z.string().optional().nullable(),
});

const pointQuerySchema = z.object({
  id: z.string().optional(),
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(100).default(10),
});

/*──────── helper – balance upsert ────────*/
async function applyBalanceDelta(
  clientId: string,
  organizationId: string,
  deltaCurrent: number,
  deltaSpent: number,
  client: Pool | PoolClient,
) {
  await client.query(
    `
    INSERT INTO "affiliatePointBalances"(
      "clientId","organizationId","pointsCurrent","pointsSpent","createdAt","updatedAt"
    )
    VALUES($1,$2,$3,$4,NOW(),NOW())
    ON CONFLICT("clientId","organizationId") DO UPDATE
      SET "pointsCurrent" = "affiliatePointBalances"."pointsCurrent" + EXCLUDED."pointsCurrent",
          "pointsSpent"   = "affiliatePointBalances"."pointsSpent"   + EXCLUDED."pointsSpent",
          "updatedAt"     = NOW()
    `,
    [clientId, organizationId, deltaCurrent, deltaSpent],
  );
}

/*──────── GET ────────*/
export async function GET(req: NextRequest) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { organizationId } = ctx;

  const qp = pointQuerySchema.parse(Object.fromEntries(new URL(req.url).searchParams.entries()));
  const { id, page, pageSize } = qp;
  const where: string[] = [`"organizationId" = $1`];
  const vals: any[] = [organizationId];
  if (id) {
    where.push(`"clientId" = $2`);
    vals.push(id);
  }

  const [{ count }] = (
    await pool.query(`SELECT COUNT(*) FROM "affiliatePointLogs" WHERE ${where.join(" AND ")}`, vals)
  ).rows;
  const totalPages = Math.ceil(Number(count) / pageSize);

  const { rows } = await pool.query(
    `
    SELECT id,"clientId","organizationId",points,action,description,
           "sourceClientId","createdAt","updatedAt"
    FROM "affiliatePointLogs"
    WHERE ${where.join(" AND ")}
    ORDER BY "createdAt" DESC
    LIMIT $${vals.length + 1} OFFSET $${vals.length + 2}
    `,
    [...vals, pageSize, (page - 1) * pageSize],
  );

  return NextResponse.json({ logs: rows, totalPages, currentPage: page });
}

/*──────── POST ────────*/
export async function POST(req: NextRequest) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { organizationId } = ctx;

  try {
    const payload = pointCreateSchema.parse(await req.json());
    const id = uuidv4();

    // start tx
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const { rows } = await client.query(
        `
        INSERT INTO "affiliatePointLogs"(
          id,"organizationId","clientId",points,action,description,"sourceClientId",
          "createdAt","updatedAt"
        )
        VALUES($1,$2,$3,$4,$5,$6,$7,NOW(),NOW())
        RETURNING *
        `,
        [
          id,
          organizationId,
          payload.id,
          payload.points,
          payload.action,
          payload.description ?? null,
          payload.sourceId ?? null,
        ],
      );

      const deltaCurrent = payload.points;
      const deltaSpent = payload.points < 0 ? Math.abs(payload.points) : 0;
      await applyBalanceDelta(payload.id, organizationId, deltaCurrent, deltaSpent, client);

      await client.query("COMMIT");
      return NextResponse.json(rows[0], { status: 201 });
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  } catch (e: any) {
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: e.errors }, { status: 400 });
    }
    console.error(e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
