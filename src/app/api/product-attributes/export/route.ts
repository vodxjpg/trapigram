// File: /app/api/product-attributes/export/route.ts
import { NextRequest } from 'next/server';
import * as XLSX from 'xlsx';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
    try {
        // Parse incoming JSON
        /*  const { attributes } = (await request.json()) as {
             attributes: Array<{ name: string; slug: string; _count?: { terms: number } }>;
         }; */
        const { attributes } = await request.json()
        console.log(attributes)

        if (!Array.isArray(attributes)) {
            return new Response(
                JSON.stringify({ error: 'Invalid payload: attributes must be an array' }),
                { status: 400, headers: { 'Content-Type': 'application/json' } }
            );
        }

        // Prepare rows for Excel
        const rows = attributes.map(attr => ({
            id: attr.id,
            name: attr.name,
            slug: attr.slug,
        }));

        // 2) Dummy row (put whatever you want here)
        const dummyRow = {
            id: 'example-id',
            slug: 'example-slug',
            name: 'example-name',
        }

        // Create sheet and workbook
        const worksheet = XLSX.utils.json_to_sheet([dummyRow, ...rows]);
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
                'Content-Disposition': 'attachment; filename="attributes.xlsx"',
            },
        });
    } catch (err: any) {
        return new Response(
            JSON.stringify({ error: err.message || 'Internal server error' }),
            { status: 500, headers: { 'Content-Type': 'application/json' } }
        );
    }
}
