// app/api/suppliers/route.ts
import { NextRequest, NextResponse } from "next/server";
import { pgPool as pool, db } from "@/lib/db";
import { getContext } from "@/lib/context";
import { v4 as uuidv4 } from "uuid";

export async function GET(req: NextRequest) {
    const ctx = await getContext(req);
    if (ctx instanceof NextResponse) return ctx;
    const { organizationId } = ctx;

    try {
        const { rows } = await pool.query(
            `SELECT id, code, name, email, phone
                FROM suppliers
                WHERE "organizationId" = $1
                ORDER BY code ASC`,
            [organizationId]
        );
        return NextResponse.json({ suppliers: rows }, { status: 200 });
    } catch (error) {
        console.error(error);
        return NextResponse.json({ error: "Internal server error." }, { status: 500 });
    }

}

export async function POST(req: NextRequest) {
    const ctx = await getContext(req);
    if (ctx instanceof NextResponse) return ctx;
    const { organizationId } = ctx;

    try {
        const body = await req.json().catch(() => ({}));
        const name = String(body.name || "").trim();
        const email = String(body.email || "").trim();
        const code = String(body.code || "").trim();
        const phone = body.phone ? String(body.phone).trim() : null;

        if (!name || !email) {
            return NextResponse.json({ error: "Name and email are required." }, { status: 400 });
        }

        // if code is optional and you want to autogen on the server:
        let finalCode = code;
        if (!finalCode) {
            do {
                finalCode = `SUP-${uuidv4().slice(0, 8)}`
            } while (await db.selectFrom("suppliers").select("id")
                .where("code", "=", finalCode)
                .where("organizationId", "=", organizationId)
                .executeTakeFirst())
        } else {
            const exists = await db.selectFrom("suppliers").select("id")
                .where("code", "=", finalCode)
                .where("organizationId", "=", organizationId)
                .executeTakeFirst()
            if (exists) return NextResponse.json({ error: "Code already exists" }, { status: 400 })
        }
        const id = uuidv4()

        const insert = await pool.query(
            `INSERT INTO suppliers (id, "organizationId", code, name, email, phone, "createdAt", "updatedAt")
            VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
            RETURNING id, code, name, email, phone`,
            [id, organizationId, finalCode, name, email, phone]
        );
        return NextResponse.json({ supplier: insert.rows[0] }, { status: 201 });
    } catch (error) {
        console.error(error);
        return NextResponse.json({ error: "Internal server error." }, { status: 500 });
    }
}
