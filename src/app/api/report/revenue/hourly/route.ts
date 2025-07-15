// File: /app/api/cron/hourly/route.ts
import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
    // Invoke the Node‐runtime handler
    const origin = request.nextUrl.origin;
    const res = await fetch(`${origin}/api/report/revenue/hourly-db`);
    console.log(`[Cron][Edge] Triggered DB task — status ${res.status}`);
    return NextResponse.json('✅ Cron triggered', { status: 200 });
}

