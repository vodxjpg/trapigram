// File: src/app/api/coupons/export/route.ts
import { NextRequest } from 'next/server';
import * as XLSX from 'xlsx';

export const runtime = 'nodejs';

function formatDateSlash(iso: string): string {
    const d = new Date(iso);
    const dd = String(d.getUTCDate()).padStart(2, "0");
    const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
    const yyyy = d.getUTCFullYear();
    return `${dd}/${mm}/${yyyy}`;
}

export async function POST(request: NextRequest) {
    try {
        const { coupons } = (await request.json()) as {
            coupons: Array<{
                id: string;
                name: string;
                code: string;
                description: string;
                discountType: string;
                discountAmount: number;
                startDate: string;
                expirationDate: string | null;
                limitPerUser: number;
                usagePerUser: number;
                usageLimit: number;
                expendingMinimum: number;
                expendingLimit: number;
                countries: string[];
                visibility: boolean;
                stackable: boolean
            }>;
        };

        if (!Array.isArray(coupons)) {
            return new Response(JSON.stringify({ error: 'Invalid payload' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        // Map coupons to rows
        const rows = coupons.map(c => ({
            id: c.id,
            name: c.name,
            code: c.code,
            description: c.description,
            discount: c.discountAmount,
            discountType: c.discountType,
            startDate: formatDateSlash(c.startDate),
            expirationDate: c.expirationDate === '' ? formatDateSlash(c.expirationDate) : '',
            limitPerUser: c.limitPerUser,
            usageLimit: c.usageLimit,
            usagePerUser: c.usagePerUser,
            expendingMinimum: c.expendingMinimum,
            expendingLimit: c.expendingLimit,
            countries: c.countries.join(', '),
            visibility: c.visibility ? 1 : 0,
            stackable: c.stackable ? 1 : 0,
        }));

        // Build sheet & workbook
        const ws = XLSX.utils.json_to_sheet([...rows]);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Coupons');

        // Write workbook to buffer
        const buffer = XLSX.write(wb, {
            type: 'buffer',
            bookType: 'xlsx',
        });

        return new Response(buffer, {
            status: 200,
            headers: {
                'Content-Type':
                    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                'Content-Disposition': 'attachment; filename="coupons.xlsx"',
            },
        });
    } catch (err: any) {
        return new Response(
            JSON.stringify({ error: err.message || 'Internal error' }),
            { status: 500, headers: { 'Content-Type': 'application/json' } }
        );
    }
}
