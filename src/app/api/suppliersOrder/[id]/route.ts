// app/api/suppliersOrder/[id]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { pgPool as pool } from "@/lib/db";
import { getContext } from "@/lib/context";

type RouteParams = { params: { id: string } };

export async function GET(req: NextRequest, { params }: RouteParams) {
    const ctx = await getContext(req);
    if (ctx instanceof NextResponse) return ctx;

    const { organizationId } = ctx;
    const { id } = params;

    if (!id) {
        return NextResponse.json({ error: "Missing order id" }, { status: 400 });
    }

    try {
        const q = await pool.query(
            `
      SELECT
        so.id,
        so."supplierId",
        so."supplierCartId",
        so.note,
        so.status,
        so.draft,
        so."expectedAt",
        so."createdAt",
        so."updatedAt",
        json_build_object(
          'id', s.id,
          'name', s.name,
          'email', s.email,
          'phone', s.phone
        ) AS supplier
      FROM "supplierOrders" so
      LEFT JOIN "suppliers" s ON s.id = so."supplierId"
      WHERE so.id = $1
        AND so."organizationId" = $2
      LIMIT 1
      `,
            [id, organizationId]
        );

        console.log(q.rows)
        if (q.rowCount === 0) {
            return NextResponse.json({ error: "Order not found" }, { status: 404 });
        }

        // Return a consistent shape: { order: {...} }
        return NextResponse.json({ order: q.rows[0] }, { status: 200 });
    } catch (error) {
        console.error("GET /api/suppliersOrder/[id] error:", error);
        return NextResponse.json({ error: "Internal server error." }, { status: 500 });
    }
}

export async function PATCH(req: NextRequest, { params }: RouteParams) {
    const ctx = await getContext(req);
    if (ctx instanceof NextResponse) return ctx;

    const { organizationId } = ctx;
    const { id } = params;

    if (!id) {
        return NextResponse.json({ error: "Missing order id" }, { status: 400 });
    }

    try {
        const body = await req.json().catch(() => ({} as any));

        // Acceptable fields
        let nextStatus: "draft" | "pending" | "completed" | undefined;
        let nextDraft: boolean | undefined;
        const updates: string[] = [];
        const values: any[] = [];
        let i = 1;

        // Status & draft reconciliation
        if (typeof body.status === "string") {
            const s = String(body.status).toLowerCase();
            if (!["draft", "pending", "completed"].includes(s)) {
                return NextResponse.json({ error: "Invalid status" }, { status: 400 });
            }
            nextStatus = s as typeof nextStatus;
            nextDraft = s === "draft";
        }

        if (typeof body.draft === "boolean" && nextStatus === undefined) {
            nextDraft = body.draft;
            // If explicitly toggling draft without status, normalize status when needed
            if (nextDraft === true) nextStatus = "draft";
            if (nextDraft === false && body.status === undefined) {
                // If leaving draft and no explicit status provided, default to pending
                nextStatus = "pending";
            }
        }

        if (nextStatus !== undefined) {
            updates.push(`status = $${i++}`);
            values.push(nextStatus);
        }
        if (nextDraft !== undefined) {
            updates.push(`draft = $${i++}`);
            values.push(nextDraft);
        }

        if (typeof body.note === "string") {
            updates.push(`note = $${i++}`);
            values.push(body.note);
        }

        if ("expectedAt" in body) {
            const v = body.expectedAt ? new Date(body.expectedAt) : null;
            if (v !== null && isNaN(v.getTime())) {
                return NextResponse.json({ error: "Invalid expectedAt" }, { status: 400 });
            }
            updates.push(`"expectedAt" = $${i++}`);
            values.push(v);
        }

        if (updates.length === 0) {
            return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
        }

        updates.push(`"updatedAt" = NOW()`);

        const sql = `
      WITH updated AS (
        UPDATE "supplierOrders"
        SET ${updates.join(", ")}
        WHERE id = $${i++} AND "organizationId" = $${i++}
        RETURNING *
      )
      SELECT
        u.id,
        u."supplierId",
        u."supplierCartId",
        u.note,
        u.status,
        u.draft,
        u."expectedAt",
        u."createdAt",
        u."updatedAt",
        json_build_object(
          'id', s.id,
          'name', s.name,
          'email', s.email,
          'phone', s.phone
        ) AS supplier
      FROM updated u
      LEFT JOIN "suppliers" s ON s.id = u."supplierId"
      LIMIT 1
    `;

        const q = await pool.query(sql, [...values, id, organizationId]);
        if (q.rowCount === 0) {
            return NextResponse.json({ error: "Order not found" }, { status: 404 });
        }

        return NextResponse.json({ order: q.rows[0] }, { status: 200 });
    } catch (error) {
        console.error("PATCH /api/suppliersOrder/[id] error:", error);
        return NextResponse.json({ error: "Internal server error." }, { status: 500 });
    }
}

