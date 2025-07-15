// File: /app/api/cron/hourly/route.ts
import { NextRequest } from 'next/server';

export const runtime = 'edge';
export const config = {
    schedule: '0 * * * *', // every hour at minute 0
};

export async function GET(request: NextRequest) {
    // Invoke the Node‐runtime handler
    const origin = request.nextUrl.origin;
    console.log(origin)
    const res = await fetch(`${origin}/api/report/revenue/hourly-db`);
    console.log(`[Cron][Edge] Triggered DB task — status ${res.status}`);
    return new Response('✅ Cron triggered', { status: 200 });
}

