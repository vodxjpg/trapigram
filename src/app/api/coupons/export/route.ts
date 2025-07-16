// File: src/app/api/coupons/export/route.ts
import { NextRequest } from 'next/server';
import * as XLSX from 'xlsx';

export const runtime = 'nodejs';

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
                usageLimit: number;
                expendingMinimum: number;
                expendingLimit: number;
                countries: string[];
                visibility: boolean;
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
            ID: c.id,
            Name: c.name,
            Code: c.code,
            Description: c.description,
            Discount:
                c.discountType === 'percentage'
                    ? `${c.discountAmount}%`
                    : c.discountAmount,
            StartDate: c.startDate,
            ExpirationDate: c.expirationDate ?? '',
            LimitPerUser: c.limitPerUser,
            UsageLimit: c.usageLimit,
            ExpendingMinimum: c.expendingMinimum,
            ExpendingLimit: c.expendingLimit,
            Countries: c.countries.join(', '),
            Visibility: c.visibility ? 'Visible' : 'Hidden',
        }));

        // Build sheet & workbook
        const ws = XLSX.utils.json_to_sheet(rows);
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
