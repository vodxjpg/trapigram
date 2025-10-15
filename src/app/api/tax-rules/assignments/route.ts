// src/app/api/tax-rules/assignments/route.ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { pgPool as pool } from "@/lib/db";
import { v4 as uuidv4 } from "uuid";
import { getContext } from "@/lib/context";



const AssignSchema = z.object({
    taxRuleId: z.string().min(1),
    productIds: z.array(z.string().min(1)).min(1),
});

const UnassignSchema = z.object({
    taxRuleId: z.string().min(1),
    productIds: z.array(z.string().min(1)).min(1),
});

export async function GET(req: NextRequest) {
    const ctx = await getContext(req);
    if (ctx instanceof NextResponse) return ctx;
    const { organizationId } = ctx;

    try {
        const url = new URL(req.url);
        const productId = url.searchParams.get("productId");
        const productIdsParam = url.searchParams.get("productIds"); // comma-separated
        let productIds: string[] | null = null;

        if (productId) productIds = [productId];
        if (productIdsParam) productIds = productIdsParam.split(",").map((s) => s.trim()).filter(Boolean);

        const clauses = [`ptr."organizationId" = $1`];
        const params: any[] = [organizationId];

        if (productIds && productIds.length) {
            clauses.push(`ptr."productId" = ANY($2::text[])`);
            params.push(productIds);
        }

        const sql = `
      SELECT
        ptr.id,
        ptr."productId",
        tr.id         AS "taxRuleId",
        tr.name       AS "taxRuleName",
        tr.rate       AS "taxRuleRate",
        tr."isInclusive",
        tr."isActive",
        tr."taxCode",
        tr."createdAt" AS "taxRuleCreatedAt"
      FROM "productTaxRules" ptr
      JOIN "taxRules" tr ON tr.id = ptr."taxRuleId"
     WHERE ${clauses.join(" AND ")}
     ORDER BY tr.name ASC
     LIMIT 500
    `;
        const { rows } = await pool.query(sql, params);
        const assignments = rows.map((r: any) => ({
            id: r.id,
            productId: r.productId,
            taxRule: {
                id: r.taxRuleId,
                name: r.taxRuleName,
                rate: Number(r.taxRuleRate),
                ratePercent: Number(r.taxRuleRate) * 100,
                isInclusive: r.isInclusive,
                isActive: r.isActive,
                taxCode: r.taxCode,
                createdAt: r.taxRuleCreatedAt,
            },
        }));

        return NextResponse.json({ assignments }, { status: 200 });
    } catch (err: any) {
        console.error("[GET /api/tax-rules/assignments]", err);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}

export async function POST(req: NextRequest) {
    const ctx = await getContext(req);
    if (ctx instanceof NextResponse) return ctx;
    const { organizationId } = ctx;

    try {
        const { taxRuleId, productIds } = AssignSchema.parse(await req.json());

        // verify rule belongs to org
        const { rowCount: ruleOk } = await pool.query(
            `SELECT 1 FROM "taxRules" WHERE id = $1 AND "organizationId" = $2 AND "isActive" = TRUE`,
            [taxRuleId, organizationId],
        );
        if (!ruleOk) {
            return NextResponse.json({ error: "Tax rule not found for this organization or inactive" }, { status: 404 });
        }

        // verify products belong to org
        const { rows: prodRows } = await pool.query(
            `SELECT id FROM products WHERE "organizationId" = $1 AND id = ANY($2::text[])`,
            [organizationId, productIds],
        );
        const validIds = new Set(prodRows.map((r: any) => r.id));
        const invalid = productIds.filter((p) => !validIds.has(p));
        if (invalid.length) {
            return NextResponse.json(
                { error: "Some products do not belong to this organization", invalidProducts: invalid },
                { status: 400 },
            );
        }

        const c = await pool.connect();
        try {
            await c.query("BEGIN");

            // prevent duplicates by checking existing
            const { rows: existing } = await c.query(
                `SELECT "productId" FROM "productTaxRules"
          WHERE "organizationId" = $1 AND "taxRuleId" = $2 AND "productId" = ANY($3::text[])`,
                [organizationId, taxRuleId, productIds],
            );
            const existingSet = new Set(existing.map((r: any) => r.productId));
            const toInsert = productIds.filter((p) => !existingSet.has(p));

            for (const pid of toInsert) {
                await c.query(
                    `INSERT INTO "productTaxRules"
            (id,"organizationId","productId","taxRuleId","createdAt","updatedAt")
           VALUES ($1,$2,$3,$4,NOW(),NOW())`,
                    [uuidv4(), organizationId, pid, taxRuleId],
                );
            }

            await c.query("COMMIT");

            return NextResponse.json(
                { assigned: toInsert.length, skippedExisting: existingSet.size },
                { status: 201 },
            );
        } catch (e) {
            await c.query("ROLLBACK");
            throw e;
        } finally {
            c.release();
        }
    } catch (err: any) {
        console.error("[POST /api/tax-rules/assignments]", err);
        if (err instanceof z.ZodError) {
            return NextResponse.json({ error: err.errors }, { status: 400 });
        }
        return NextResponse.json({ error: err.message ?? "Internal server error" }, { status: 500 });
    }
}

export async function DELETE(req: NextRequest) {
    const ctx = await getContext(req);
    if (ctx instanceof NextResponse) return ctx;
    const { organizationId } = ctx;

    try {
        const { taxRuleId, productIds } = UnassignSchema.parse(await req.json());

        // verify rule belongs to org
        const { rowCount: ruleOk } = await pool.query(
            `SELECT 1 FROM "taxRules" WHERE id = $1 AND "organizationId" = $2`,
            [taxRuleId, organizationId],
        );
        if (!ruleOk) {
            return NextResponse.json({ error: "Tax rule not found for this organization" }, { status: 404 });
        }

        const { rowCount } = await pool.query(
            `DELETE FROM "productTaxRules"
        WHERE "organizationId" = $1
          AND "taxRuleId" = $2
          AND "productId" = ANY($3::text[])`,
            [organizationId, taxRuleId, productIds],
        );

        return NextResponse.json({ removed: rowCount ?? 0 }, { status: 200 });
    } catch (err: any) {
        console.error("[DELETE /api/tax-rules/assignments]", err);
        if (err instanceof z.ZodError) {
            return NextResponse.json({ error: err.errors }, { status: 400 });
        }
        return NextResponse.json({ error: err.message ?? "Internal server error" }, { status: 500 });
    }
}
