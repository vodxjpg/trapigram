// src/app/api/organizations/[identifier]/members/route.ts
import { NextRequest, NextResponse } from "next/server";
import { Pool } from "pg";
import { getContext } from "@/lib/context";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// …imports unchanged …
export async function GET(req: NextRequest) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { organizationId } = ctx;

  try {
    // list with joined user info
    const { rows } = await pool.query(
      `SELECT m.id,
              m."userId",
              m.role,
              u.name,
              u.email
         FROM member m
         JOIN "user" u ON u.id = m."userId"
        WHERE m."organizationId" = $1`,
      [organizationId]
    );

    return NextResponse.json({
      members: rows.map(r => ({
        id: r.id,
        userId: r.userId,
        role: r.role,
        user: { id: r.userId, name: r.name, email: r.email }
      }))
    });
  } catch (err) {
    console.error("[members GET]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
