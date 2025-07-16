// File: /app/api/product-categories/export/route.ts
import { NextRequest, NextResponse } from 'next/server';
import * as XLSX from 'xlsx';
import { getContext } from "@/lib/context";

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
    const ctx = await getContext(request);
    if (ctx instanceof NextResponse) return ctx;
    try {
        // Expect the client to send { categories: Array<{ name, slug, parentName }> }
        const { categories } = await request.json() as {
            categories: Array<{ name: string; slug: string; parentName?: string }>;
        };
        console.log(categories)
        if (!Array.isArray(categories)) {
            return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
        }

        // Map to rows for Excel
        const rows = categories.map(cat => ({
            Name: cat.name,
            Slug: cat.slug,
            Parent: cat.parentName || '',
        }));

        // Build sheet & workbook
        const ws = XLSX.utils.json_to_sheet(rows);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Categories');

        // Write workbook to Buffer
        const buffer = XLSX.write(wb, {
            type: 'buffer',
            bookType: 'xlsx',
        });

        // Return as downloadable file
        return new Response(buffer, {
            status: 200,
            headers: {
                'Content-Type':
                    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                'Content-Disposition': 'attachment; filename="categories.xlsx"',
            },
        });
    } catch (err: any) {
        return NextResponse.json(
            { error: err.message || 'Unexpected error' },
            { status: 500 }
        );
    }
}
