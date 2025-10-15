// src/app/api/tax-rules/route.ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { pgPool as pool } from "@/lib/db";
import { v4 as uuidv4 } from "uuid";
import { getContext } from "@/lib/context";


/** Accept 10 or 0.10 and store as fraction (0–1) */
function toFraction(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  return n > 1 ? n / 100 : n;
}

const CreateSchema = z.object({
  name: z.string().min(1),
  rate: z.number(), // 10 or 0.10 — both accepted
  isInclusive: z.boolean().optional().default(true),
  isActive: z.boolean().optional().default(true),
  taxCode: z.string().nullable().optional(),
});

export async function GET(req: NextRequest) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { organizationId } = ctx;

  try {
    const url = new URL(req.url);
    const activeParam = url.searchParams.get("active");
    const q = url.searchParams.get("q")?.trim();

    const clauses: string[] = [`"organizationId" = $1`];
    const params: any[] = [organizationId];

    if (activeParam === "true" || activeParam === "1") {
      clauses.push(`"isActive" = TRUE`);
    }
    if (q && q.length > 0) {
      params.push(`%${q}%`);
      clauses.push(`(LOWER(name) LIKE LOWER($${params.length}) OR LOWER(COALESCE("taxCode", '')) LIKE LOWER($${params.length}))`);
    }

    const sql = `
      SELECT id,name,rate,"isInclusive","isActive","taxCode","createdAt","updatedAt"
        FROM "taxRules"
       WHERE ${clauses.join(" AND ")}
       ORDER BY "createdAt" DESC
       LIMIT 200
    `;
    const { rows } = await pool.query(sql, params);

    const data = rows.map((r: any) => ({
      ...r,
      ratePercent: Number(r.rate) * 100,
      rate: Number(r.rate),
    }));

    return NextResponse.json({ taxRules: data }, { status: 200 });
  } catch (err: any) {
    console.error("[GET /api/tax-rules]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { organizationId } = ctx;

  try {
    const parsed = CreateSchema.parse(await req.json());
    const id = uuidv4();
    const rate = toFraction(parsed.rate);

    const { rows } = await pool.query(
      `INSERT INTO "taxRules"
         (id,"organizationId",name,rate,"isInclusive","isActive","taxCode","createdAt","updatedAt")
       VALUES ($1,$2,$3,$4,$5,$6,$7,NOW(),NOW())
       RETURNING id,name,rate,"isInclusive","isActive","taxCode","createdAt","updatedAt"`,
      [id, organizationId, parsed.name, rate, parsed.isInclusive, parsed.isActive, parsed.taxCode ?? null],
    );

    const r = rows[0];
    return NextResponse.json(
      {
        taxRule: {
          ...r,
          rate: Number(r.rate),
          ratePercent: Number(r.rate) * 100,
        },
      },
      { status: 201 },
    );
  } catch (err: any) {
    console.error("[POST /api/tax-rules]", err);
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.errors }, { status: 400 });
    }
    return NextResponse.json({ error: err.message ?? "Internal server error" }, { status: 500 });
  }
}
