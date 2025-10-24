// components/OrderSummary.tsx
"use client";

import { DollarSign } from "lucide-react";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { formatCurrency } from "@/lib/currency";

export interface OrderSummaryProps {
    /** Whether the order/cart has been generated */
    orderGenerated: boolean;

    /** Customer email shown in the summary */
    clientEmail: string;

    /** Count of cart lines/items */
    itemsCount: number;

    /** Raw items subtotal BEFORE discounts and shipping */
    itemsSubtotal: number;

    /** Total discount from coupons */
    discountTotal: number;

    /** Shipping cost selected by user */
    shippingCost: number;

    /** Final total (itemsSubtotal - discountTotal + shippingCost) */
    total: number;

    /** Country code for currency formatting */
    clientCountry: string;

    /** Create order handler */
    onCreateOrder: () => void | Promise<void>;

    /** Disable state for Create button (same conditions as original) */
    createDisabled: boolean;
}

export default function OrderSummary({
    orderGenerated,
    clientEmail,
    itemsCount,
    itemsSubtotal,
    discountTotal,
    shippingCost,
    total,
    clientCountry,
    onCreateOrder,
    createDisabled,
}: OrderSummaryProps) {
    return (
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    <DollarSign className="h-5 w-5" /> Order Summary
                </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
                {orderGenerated ? (
                    <div className="space-y-2">
                        <div className="flex justify-between">
                            <span>Client:</span>
                            <span className="font-medium">{clientEmail}</span>
                        </div>

                        <div className="flex justify-between">
                            <span>Items:</span>
                            <span className="font-medium">{itemsCount}</span>
                        </div>

                        {/* NEW: Subtotal (items) */}
                        <div className="flex justify-between">
                            <span>Subtotal (items):</span>
                            <span className="font-medium">
                                {formatCurrency(itemsSubtotal, clientCountry)}
                            </span>
                        </div>

                        {/* Discount from coupons */}
                        {discountTotal > 0 && (
                            <div className="flex justify-between text-green-600">
                                <span>Discount (coupons):</span>
                                <span className="font-medium">
                                    –{formatCurrency(discountTotal, clientCountry)}
                                </span>
                            </div>
                        )}

                        {/* Shipping */}
                        <div className="flex justify-between">
                            <span>Shipping:</span>
                            <span className="font-medium">
                                {formatCurrency(shippingCost, clientCountry)}
                            </span>
                        </div>

                        <Separator />

                        {/* Final total */}
                        <div className="flex justify-between text-lg font-bold">
                            <span>Total:</span>
                            <span>{formatCurrency(total, clientCountry)}</span>
                        </div>
                    </div>
                ) : (
                    <div className="text-center py-6 text-muted-foreground">
                        Select a client and generate an order to see the summary
                    </div>
                )}
            </CardContent>
            <CardFooter className="flex flex-col gap-3">
                <Button onClick={onCreateOrder} disabled={createDisabled} className="w-full">
                    Create Order
                </Button>
            </CardFooter>
        </Card>
    );
}
