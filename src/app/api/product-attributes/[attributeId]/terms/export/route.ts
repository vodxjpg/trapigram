// File: /app/api/product-terms/export/route.ts
import { NextRequest } from 'next/server';
import * as XLSX from 'xlsx';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
    try {
        // Parse incoming JSON
        /* const { terms } = (await request.json()) as {
            terms: Array<{ name: string; slug: string; _count?: { terms: number } }>;
        }; */
        const { terms } = await request.json()

        if (!Array.isArray(terms)) {
            return new Response(
                JSON.stringify({ error: 'Invalid payload: terms must be an array' }),
                { status: 400, headers: { 'Content-Type': 'application/json' } }
            );
        }

        // Prepare rows for Excel
        const rows = terms.map(attr => ({
            id: attr.id,
            name: attr.name,
            slug: attr.slug,
        }));

        // Create sheet and workbook
        const worksheet = XLSX.utils.json_to_sheet(rows);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, 'Attributes');

        // Generate buffer
        const buffer = XLSX.write(workbook, {
            type: 'buffer',
            bookType: 'xlsx',
        });

        // Return as downloadable .xlsx
        return new Response(buffer, {
            status: 200,
            headers: {
                'Content-Type':
                    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                'Content-Disposition': 'attachment; filename="terms.xlsx"',
            },
        });
    } catch (err: any) {
        return new Response(
            JSON.stringify({ error: err.message || 'Internal server error' }),
            { status: 500, headers: { 'Content-Type': 'application/json' } }
        );
    }
}
