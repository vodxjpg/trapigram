import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { Pool } from "pg";

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
});

export async function POST(req: NextRequest) {
    console.log("test")
    const session = await auth.api.getSession({ headers: req.headers });
    if (!session?.user) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
        const apiKey = await auth.api.createApiKey({
            body: {
              name: "My API Key",
              expiresIn: 60 * 60 * 24 * 365, // 1 year
              prefix: "my_app",
              remaining: 100,
              refillAmount: 100,
              refillInterval: 60 * 60 * 24 * 7, // 7 days
              metadata: {
                tier: "premium",
              },
              rateLimitTimeWindow: 1000 * 60 * 60 * 24, // everyday
              rateLimitMax: 100, // every day, they can use up to 100 requests
              rateLimitEnabled: true,
              userId: session?.user.id, // the user id to create the API key for
            },
          });

        return NextResponse.json({ apiKey: apiKey.key }, { status: 201 });
    } catch (err) {
        return NextResponse.json(
            { error: "Failed to create API key" },
            { status: 500 }
        );
    }
}