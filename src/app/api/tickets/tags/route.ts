// /src/app/api/tickets/route.ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Pool } from "pg";
import { getContext } from "@/lib/context";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

/* -------------------------------------------------------------------------- */
/* 1. Zod schema                                                              */
/* -------------------------------------------------------------------------- */
const tagSchema = z.object({
  id: z.string(),
  description: z.string(),
});

/* -------------------------------------------------------------------------- */
/* 2. GET  /api/tags                                                       */
/* -------------------------------------------------------------------------- */
export async function GET(req: NextRequest) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;

  try {
    const query = `
    SELECT id, "description"
    FROM tags
  `;

    const tags = (await pool.query(query)).rows
    console.log(tags)

    return NextResponse.json({ tags });
  } catch (err) {
    console.error("[GET /api/tags]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}