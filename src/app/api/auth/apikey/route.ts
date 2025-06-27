import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { pgPool as pool } from "@/lib/db";;

// nothing

interface ApiKeyRequest {
    name: string,
    apikey: string
  }

export async function POST(req: NextRequest) {
    const session = await auth.api.getSession({ headers: req.headers });
    if (!session?.user) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body: ApiKeyRequest = await req.json();

   try {
        const apiKey = await auth.api.createApiKey({
            body: {
              name: body.name,
              expiresIn: 60 * 60 * 24 * 365, // 1 year
              prefix: "tp_",
              remaining: null,
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

          console.log(apiKey, "acaaaaaaaaaaaa")

        return NextResponse.json({ apiKey: apiKey.key }, { status: 201 });
    } catch (err) {
        return NextResponse.json(
            { error: "Failed to create API key" },
            { status: 500 }
        );
    }
}

export async function GET(req: NextRequest) {

    const session = await auth.api.getSession({ headers: req.headers });
    if (!session?.user) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
        const key = await auth.api.getApiKey({
            body: {
                keyId: "bFfX4a7I3iO0YfDb8kDZMbvTnPu2JYxG"
            }
        });

        return NextResponse.json({ key }, { status: 201 });
    } catch (err) {
        return NextResponse.json(
            { error: "Failed to create API key" },
            { status: 500 }
        );
    }
}
