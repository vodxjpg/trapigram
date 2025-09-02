// app/api/suppliers/[id]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { pgPool as pool } from "@/lib/db";
import { getContext } from "@/lib/context";

type Params = { params: { id: string } };

// ─────────────────────────────────────────────────────────────
// PATCH /api/suppliers/:id  (partial update)
// body: { code?, name?, email?, phone? }
// returns: { supplier }
// ─────────────────────────────────────────────────────────────
export async function PATCH(req: NextRequest, { params }: Params) {
    const ctx = await getContext(req);
    if (ctx instanceof NextResponse) return ctx;
    const { organizationId } = ctx;

    const id = String(params.id || "").trim();
    if (!id) return NextResponse.json({ error: "Missing id." }, { status: 400 });

    // Ensure the row exists and belongs to this org
    const curQ = await pool.query(
        `SELECT id, code, name, email, phone
       FROM suppliers
      WHERE id = $1 AND "organizationId" = $2
      LIMIT 1`,
        [id, organizationId],
    );
    if (!curQ.rowCount) {
        return NextResponse.json({ error: "Supplier not found." }, { status: 404 });
    }
    const current = curQ.rows[0] as {
        id: string; code: string; name: string; email: string; phone: string | null;
    };

    // Parse + normalize body
    const body = await req.json().catch(() => ({}));
    const has = (k: string) => Object.prototype.hasOwnProperty.call(body, k);

    const nextCode = has("code") ? String(body.code ?? "").trim() : undefined;
    const nextName = has("name") ? String(body.name ?? "").trim() : undefined;
    const nextEmail = has("email") ? String(body.email ?? "").trim() : undefined;
    // allow clearing phone by sending "" or null
    const nextPhone = has("phone")
        ? (body.phone === null
            ? null
            : (() => {
                const t = String(body.phone ?? "").trim();
                return t.length ? t : null;
            })())
        : undefined;

    // Nothing to change?
    if (
        nextCode === undefined &&
        nextName === undefined &&
        nextEmail === undefined &&
        nextPhone === undefined
    ) {
        return NextResponse.json({ error: "No fields to update." }, { status: 400 });
    }

    // basic validations (only when provided)
    if (nextName !== undefined && !nextName) {
        return NextResponse.json({ error: "Name cannot be empty." }, { status: 400 });
    }
    if (nextEmail !== undefined && !nextEmail) {
        return NextResponse.json({ error: "Email cannot be empty." }, { status: 400 });
    }
    if (nextCode !== undefined && !nextCode) {
        return NextResponse.json({ error: "Code cannot be empty." }, { status: 400 });
    }

    // Enforce code uniqueness inside the organization (if changing)
    if (nextCode !== undefined && nextCode !== current.code) {
        const existsQ = await pool.query(
            `SELECT 1 FROM suppliers
        WHERE code = $1 AND "organizationId" = $2 AND id <> $3
        LIMIT 1`,
            [nextCode, organizationId, id],
        );
        if (existsQ.rowCount) {
            return NextResponse.json({ error: "Code already exists." }, { status: 400 });
        }
    }

    // Build dynamic UPDATE
    const sets: string[] = [];
    const vals: any[] = [];
    const add = (sql: string, v: any) => {
        vals.push(v);
        sets.push(`${sql} $${vals.length}`);
    };

    if (nextCode !== undefined) add(`code =`, nextCode);
    if (nextName !== undefined) add(`name =`, nextName);
    if (nextEmail !== undefined) add(`email =`, nextEmail);
    if (nextPhone !== undefined) add(`phone =`, nextPhone);

    // Always bump updatedAt
    const sql = `
    UPDATE suppliers
       SET ${sets.join(", ")}, "updatedAt" = NOW()
     WHERE id = $${vals.length + 1} AND "organizationId" = $${vals.length + 2}
     RETURNING id, code, name, email, phone
  `;
    vals.push(id, organizationId);

    try {
        const upd = await pool.query(sql, vals);
        if (!upd.rowCount) {
            return NextResponse.json({ error: "Supplier not found." }, { status: 404 });
        }
        return NextResponse.json({ supplier: upd.rows[0] }, { status: 200 });
    } catch (err) {
        console.error("PATCH /suppliers/:id error:", err);
        return NextResponse.json({ error: "Internal server error." }, { status: 500 });
    }
}

// ─────────────────────────────────────────────────────────────
// DELETE /api/suppliers/:id
// returns: 204 No Content
// ─────────────────────────────────────────────────────────────
export async function DELETE(req: NextRequest, { params }: Params) {
    const ctx = await getContext(req);
    if (ctx instanceof NextResponse) return ctx;
    const { organizationId } = ctx;

    const id = String(params.id || "").trim();
    if (!id) return NextResponse.json({ error: "Missing id." }, { status: 400 });

    try {
        const del = await pool.query(
            `DELETE FROM suppliers
        WHERE id = $1 AND "organizationId" = $2
        RETURNING id`,
            [id, organizationId],
        );
        if (!del.rowCount) {
            return NextResponse.json({ error: "Supplier not found." }, { status: 404 });
        }
        return new NextResponse(null, { status: 204 });
    } catch (err) {
        console.error("DELETE /suppliers/:id error:", err);
        return NextResponse.json({ error: "Internal server error." }, { status: 500 });
    }
}
