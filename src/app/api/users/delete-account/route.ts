import { NextRequest, NextResponse } from "next/server";
import { Pool } from "pg";
import { getContext } from "@/lib/context";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

export async function PATCH(req: NextRequest) {
    const ctx = await getContext(req);
    if (ctx instanceof NextResponse) return ctx;
    const { userId, organizationId } = ctx

    try {
        const emailUser = `
        SELECT email FROM "user" WHERE id='${userId}'
        `

        const resultEmail = await pool.query(emailUser);
        const email = resultEmail.rows[0].email

        const updateEmailUser = `
        UPDATE "user" SET "email" = '${'deleted.' + email}' WHERE id='${userId}'
        `
        const resultUpdatedEmail = await pool.query(updateEmailUser);

        const updateMembers = `
                DELETE from "member" WHERE "organizationId" = '${organizationId}' AND "userId" = '${userId}' AND "role" = 'manager'
            `
        await pool.query(updateMembers);

        return NextResponse.json(resultUpdatedEmail.rows, { status: 201 });
    } catch (error) {
        return NextResponse.json(error, { status: 500 });
    }
}