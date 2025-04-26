import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from '@/lib/db';

interface ApiKeyRequest {
    name: string,
    apikey: string
}

export async function POST(req: NextRequest) {
    const session = await auth.api.getSession({ headers: req.headers });
    if (!session?.user) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const data = await db
        .selectFrom('apikey')
        .select(['id'])
        .where('userId', '=', session?.user.id)
        .executeTakeFirst();

    const id = data.id

    try {
        const apiKey = await auth.api.updateApiKey({
            body: {
                keyId: id,
                expiresIn: 60 * 60 * 24 * 7,
            }
        })

        return NextResponse.json({ apiKey }, { status: 201 });
    } catch (err) {
        return NextResponse.json(
            { error: "Failed to update API key" },
            { status: 500 }
        );
    }
}