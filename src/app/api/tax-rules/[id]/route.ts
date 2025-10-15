// src/app/api/tax-rules/[id]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { pgPool as pool } from "@/lib/db";
import { getContext } from "@/lib/context";

/** Accept 10 or 0.10 and store as fraction (0–1) */
function toFraction(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  return n > 1 ? n / 100 : n;
}

const PatchSchema = z.object({
  name: z.string().min(1).optional(),
  rate: z.number().optional(), // 10 or 0.10
  isInclusive: z.boolean().optional(),
  isActive: z.boolean().optional(),
  taxCode: z.string().nullable().optional(),
});

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { organizationId } = ctx;

  try {
    const { id } = await params;
    const { rows } = await pool.query(
      `SELECT id,name,rate,"isInclusive","isActive","taxCode","createdAt","updatedAt"
         FROM "taxRules"
        WHERE id = $1 AND "organizationId" = $2`,
      [id, organizationId],
    );
    if (!rows.length) {
      return NextResponse.json({ error: "Tax rule not found" }, { status: 404 });
    }
    const r = rows[0];
    return NextResponse.json(
      { taxRule: { ...r, rate: Number(r.rate), ratePercent: Number(r.rate) * 100 } },
      { status: 200 },
    );
  } catch (err: any) {
    console.error("[GET /api/tax-rules/:id]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { organizationId } = ctx;

  try {
    const { id } = await params;
    const patch = PatchSchema.parse(await req.json());

    // verify ownership
    const { rowCount } = await pool.query(
      `SELECT 1 FROM "taxRules" WHERE id = $1 AND "organizationId" = $2`,
      [id, organizationId],
    );
    if (!rowCount) {
      return NextResponse.json({ error: "Tax rule not found" }, { status: 404 });
    }

    const sets: string[] = [];
    const vals: any[] = [];
    let idx = 1;

    if (patch.name !== undefined) {
      sets.push(`name = $${++idx}`);
      vals.push(patch.name);
    }
    if (patch.rate !== undefined) {
      sets.push(`rate = $${++idx}`);
      vals.push(toFraction(patch.rate));
    }
    if (patch.isInclusive !== undefined) {
      sets.push(`"isInclusive" = $${++idx}`);
      vals.push(patch.isInclusive);
    }
    if (patch.isActive !== undefined) {
      sets.push(`"isActive" = $${++idx}`);
      vals.push(patch.isActive);
    }
    if (patch.taxCode !== undefined) {
      sets.push(`"taxCode" = $${++idx}`);
      vals.push(patch.taxCode);
    }

    sets.push(`"updatedAt" = NOW()`);

    const sql = `
      UPDATE "taxRules"
         SET ${sets.join(", ")}
       WHERE id = $1 AND "organizationId" = $2
       RETURNING id,name,rate,"isInclusive","isActive","taxCode","createdAt","updatedAt"
    `;
    const { rows } = await pool.query(sql, [id, organizationId, ...vals]);

    const r = rows[0];
    return NextResponse.json(
      { taxRule: { ...r, rate: Number(r.rate), ratePercent: Number(r.rate) * 100 } },
      { status: 200 },
    );
  } catch (err: any) {
    console.error("[PATCH /api/tax-rules/:id]", err);
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.errors }, { status: 400 });
    }
    return NextResponse.json({ error: err.message ?? "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { organizationId } = ctx;

  try {
    const { id } = await params;
    const url = new URL(req.url);
    const force = ["1", "true", "yes"].includes((url.searchParams.get("force") ?? "").toLowerCase());

    // exists + ownership
    const { rowCount } = await pool.query(
      `SELECT 1 FROM "taxRules" WHERE id = $1 AND "organizationId" = $2`,
      [id, organizationId],
    );
    if (!rowCount) {
      return NextResponse.json({ error: "Tax rule not found" }, { status: 404 });
    }

    // check assignments
    const { rows: cntRows } = await pool.query(
      `SELECT COUNT(*)::int AS c FROM "productTaxRules" WHERE "taxRuleId" = $1`,
      [id],
    );
    const assignedCount = Number(cntRows[0].c ?? 0);

    if (assignedCount > 0 && !force) {
      return NextResponse.json(
        { error: "Tax rule is assigned to products. Unassign first or use ?force=true." },
        { status: 409 },
      );
    }

    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      if (assignedCount > 0) {
        await c.query(`DELETE FROM "productTaxRules" WHERE "taxRuleId" = $1`, [id]);
      }
      await c.query(`DELETE FROM "taxRules" WHERE id = $1 AND "organizationId" = $2`, [id, organizationId]);
      await c.query("COMMIT");
      return NextResponse.json({ deleted: true, removedAssignments: assignedCount }, { status: 200 });
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    } finally {
      c.release();
    }
  } catch (err: any) {
    console.error("[DELETE /api/tax-rules/:id]", err);
    return NextResponse.json({ error: err.message ?? "Internal server error" }, { status: 500 });
  }
}
