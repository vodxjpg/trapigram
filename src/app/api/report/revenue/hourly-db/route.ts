// File: /app/api/cron/hourly-db/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { pgPool } from '@/lib/db';

export const runtime = 'nodejs'; // Node.js serverless

export async function GET(req: NextRequest) {
    const apiKey = '144659c7b175794ed4eae9bacf853944'
    if (!apiKey) {
        return NextResponse.json({ error: 'Missing CURRENCYLAYER_KEY env var' }, { status: 500 });
    }

    const url = `https://api.currencylayer.com/live?access_key=${apiKey}&currencies=EUR,GBP`;
    const res = await fetch(url);
    const data = await res.json();

    const usdEur = data.quotes?.USDEUR;
    const usdGbp = data.quotes?.USDGBP;
    if (usdEur == null || usdGbp == null) {
        return NextResponse.json({ error: 'Invalid API response' }, { status: 502 });
    }

    const insertSql = `
    INSERT INTO "exchangeRate" ("EUR","GBP", date)
    VALUES (${usdEur}, ${usdGbp}, NOW())
    `;
    await pgPool.query(insertSql);
    console.log(`[Cron][DB] Inserted rates EUR=${usdEur} GBP=${usdGbp} at ${new Date().toISOString()}`);

    return NextResponse.json({ usdEur, usdGbp }, { status: 200 });
}