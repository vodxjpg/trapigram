// File: src/app/api/reviews/route.ts
import { NextRequest, NextResponse } from "next/server";
import { Pool } from "pg";
import { getContext } from "@/lib/context";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

export async function GET(req: NextRequest) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { organizationId } = ctx;

  try {

    // 2. Parse pagination & search params
    const { searchParams } = new URL(req.url);
    const page = Number(searchParams.get("page")) || 1;
    const pageSize = Number(searchParams.get("pageSize")) || 10;
    const search = searchParams.get("search")?.trim() || "";

    // 3. Build COUNT query
    let countSql = `SELECT COUNT(*) FROM reviews WHERE "organizationId" = $1`;
    const countVals: any[] = [organizationId];
    if (search) {
      countSql += ` AND ("orderId" ILIKE $2 OR text ILIKE $2)`;
      countVals.push(`%${search}%`);
    }

    // 4. Build paginated SELECT
    let dataSql = `
    SELECT id,
           "orderId",
           text,
           rate,
           "createdAt",
           "updatedAt"
    FROM reviews
    WHERE "organizationId" = $1
  `;
    const dataVals: any[] = [organizationId];
    if (search) {
      dataSql += ` AND ("orderId" ILIKE $2 OR text ILIKE $2)`;
      dataVals.push(`%${search}%`);
    }
    dataSql += ` ORDER BY "createdAt" DESC
               LIMIT $${dataVals.length + 1}
               OFFSET $${dataVals.length + 2}`;
    dataVals.push(pageSize, (page - 1) * pageSize);


    // run COUNT
    const countRes = await pool.query(countSql, countVals);
    const totalRows = Number(countRes.rows[0].count);
    const totalPages = Math.ceil(totalRows / pageSize);

    // run SELECT
    const dataRes = await pool.query(dataSql, dataVals);
    const reviews = dataRes.rows;

    return NextResponse.json({
      reviews,
      totalPages,
      currentPage: page,
    });
  } catch (err: any) {
    console.error("[GET /api/reviews] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
