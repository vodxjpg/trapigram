"use client";
import { formatCurrency } from "@/lib/currency";

type Props = {
    clientEmail?: string;
    itemsCount: number;
    discountTotal: number;
    shippingCost: number;
    itemsSubtotal: number;
    totalBefore: number;
    total: number;
    country: string;
};

export function SummaryCard({ clientEmail, itemsCount, discountTotal, shippingCost, itemsSubtotal, totalBefore, total, country }: Props) {
    return (
        <div className="space-y-2">
            <div className="flex justify-between"><span>Client:</span><span className="font-medium">{clientEmail || "-"}</span></div>
            <div className="flex justify-between"><span>Items:</span><span className="font-medium">{itemsCount}</span></div>
            {discountTotal > 0 && (
                <div className="flex justify-between text-green-600">
                    <span>Discount (coupons):</span>
                    <span className="font-medium">–{formatCurrency(discountTotal, country)}</span>
                </div>
            )}
            <div className="flex justify-between"><span>Items Subtotal:</span><span className="font-medium">{formatCurrency(itemsSubtotal, country)}</span></div>
            <div className="flex justify-between"><span>Shipping:</span><span className="font-medium">{formatCurrency(shippingCost, country)}</span></div>
            <div className="flex justify-between"><span>Total before shipping:</span><span className="font-medium">{formatCurrency(totalBefore, country)}</span></div>
            <div className="flex justify-between text-lg">
                <span>Total:</span>
                <span className="font-bold">{formatCurrency(total, country)}</span>
            </div>
        </div>
    );
}
