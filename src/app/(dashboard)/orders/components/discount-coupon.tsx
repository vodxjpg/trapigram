// components/DiscountCoupon.tsx
"use client";

import { Tag } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
    Card,
    CardContent,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatCurrency } from "@/lib/currency";

export interface DiscountCouponProps {
    orderGenerated: boolean;
    // values/state
    appliedCodes: string[];
    discountTotal: number;
    clientCountry: string;
    couponCode: string;
    setCouponCode: (v: string) => void;
    couponBreakdown: {
        code: string;
        discountType: "percentage" | "fixed";
        discountValue: number;
        discountAmount: number;
        subtotalAfter: number;
    }[];
    // handlers
    applyCoupon: () => void | Promise<void>;
}

export default function DiscountCoupon(props: DiscountCouponProps) {
    const {
        orderGenerated,
        appliedCodes,
        discountTotal,
        clientCountry,
        couponCode,
        setCouponCode,
        couponBreakdown,
        applyCoupon,
    } = props;

    return (
        <Card className={!orderGenerated ? "opacity-50 pointer-events-none" : ""}>
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    <Tag className="h-5 w-5" /> Discount Coupon
                </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
                {/* Applied codes summary */}
                {appliedCodes.length > 0 && discountTotal > 0 && (
                    <div className="flex justify-between text-green-600">
                        <span>Discount (coupons):</span>
                        <span className="font-medium">
                            –{formatCurrency(discountTotal, clientCountry)}
                        </span>
                    </div>
                )}

                <div className="flex flex-col sm:flex-row gap-4">
                    <div className="flex-1">
                        <Label>Coupon Code</Label>
                        <Input
                            value={couponCode}
                            onChange={(e) => setCouponCode(e.target.value)}
                            placeholder="Enter coupon code"
                        />
                    </div>
                    <div className="flex items-end">
                        <Button onClick={applyCoupon} disabled={!couponCode}>
                            {appliedCodes.length ? "Apply Another" : "Apply Coupon"}
                        </Button>
                    </div>
                </div>

                {/* Optional: show breakdown lines */}
                {couponBreakdown.length > 0 && (
                    <div className="mt-2 space-y-1 text-sm text-muted-foreground">
                        {couponBreakdown.map((b, i) => (
                            <div key={`${b.code}-${i}`} className="flex justify-between">
                                <span>
                                    {b.code} —{" "}
                                    {b.discountType === "percentage"
                                        ? `${b.discountValue}%`
                                        : `-${formatCurrency(b.discountAmount, clientCountry)}`}
                                </span>
                                <span>Subtotal: {formatCurrency(b.subtotalAfter, clientCountry)}</span>
                            </div>
                        ))}
                    </div>
                )}
            </CardContent>
        </Card>
    );
}
