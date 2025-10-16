"use client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CouponBreakdown } from "../types";
import { formatCurrency } from "@/lib/currency";

type Props = {
    country: string;
    couponCode: string; setCouponCode: (v: string) => void;
    appliedCodes: string[]; discountTotal: number; breakdown: CouponBreakdown[];
    onApply: () => void;
};

export function CouponForm({ country, couponCode, setCouponCode, appliedCodes, discountTotal, breakdown, onApply }: Props) {
    return (
        <div className="space-y-4">
            {appliedCodes.length > 0 && discountTotal > 0 && (
                <div className="flex justify-between text-green-600">
                    <span>Discount (coupons):</span>
                    <span className="font-medium">–{formatCurrency(discountTotal, country)}</span>
                </div>
            )}
            <div className="flex flex-col sm:flex-row gap-4">
                <div className="flex-1">
                    <Label>Coupon Code</Label>
                    <Input value={couponCode} onChange={(e) => setCouponCode(e.target.value)} placeholder="Enter coupon code" />
                </div>
                <div className="flex items-end">
                    <Button onClick={onApply} disabled={!couponCode}>
                        {appliedCodes.length ? "Apply Another" : "Apply Coupon"}
                    </Button>
                </div>
            </div>
            {breakdown.length > 0 && (
                <div className="mt-2 space-y-1 text-sm text-muted-foreground">
                    {breakdown.map((b, i) => (
                        <div key={`${b.code}-${i}`} className="flex justify-between">
                            <span>
                                {b.code} — {b.discountType === "percentage" ? `${b.discountValue}%` : `-${formatCurrency(b.discountAmount, country)}`}
                            </span>
                            <span>Subtotal: {formatCurrency(b.subtotalAfter, country)}</span>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
