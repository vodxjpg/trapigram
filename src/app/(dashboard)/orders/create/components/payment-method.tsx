// components/PaymentMethod.tsx
"use client";

import { CreditCard } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export interface PaymentMethodProps {
    orderGenerated: boolean;

    paymentMethods: { id: string; name: string; active?: boolean }[];
    selectedPaymentMethod: string;
    setSelectedPaymentMethod: (id: string) => void;

    /** Niftipay network selector (shown when PM name === 'niftipay') */
    niftipayNetworks: { chain: string; asset: string; label: string }[];
    niftipayLoading: boolean;
    selectedNiftipay: string;
    setSelectedNiftipay: (val: string) => void;
}

export default function PaymentMethod(props: PaymentMethodProps) {
    const {
        orderGenerated,
        paymentMethods,
        selectedPaymentMethod,
        setSelectedPaymentMethod,
        niftipayNetworks,
        niftipayLoading,
        selectedNiftipay,
        setSelectedNiftipay,
    } = props;

    const isNiftipaySelected = paymentMethods.find(
        (p) => p.id === selectedPaymentMethod && p.name.toLowerCase() === "niftipay"
    );

    return (
        <Card className={!orderGenerated ? "opacity-50 pointer-events-none" : ""}>
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    <CreditCard className="h-5 w-5" /> Payment Method
                </CardTitle>
            </CardHeader>
            <CardContent>
                <Label htmlFor="payment">Select Payment Method</Label>
                <Select
                    value={selectedPaymentMethod}
                    onValueChange={setSelectedPaymentMethod}
                    disabled={!orderGenerated}
                >
                    <SelectTrigger id="payment">
                        <SelectValue placeholder="Select a payment method" />
                    </SelectTrigger>
                    <SelectContent>
                        {paymentMethods.map((m) => (
                            <SelectItem key={m.id} value={m.id}>
                                {m.name}
                                {m.active === false ? " (inactive)" : ""}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>

                {/* Niftipay network selector */}
                {isNiftipaySelected && (
                    <div className="mt-4">
                        <Label>Select Crypto Network</Label>
                        <Select
                            value={selectedNiftipay}
                            onValueChange={setSelectedNiftipay}
                            disabled={niftipayLoading}
                        >
                            <SelectTrigger>
                                <SelectValue placeholder={niftipayLoading ? "Loading…" : "Select network"} />
                            </SelectTrigger>
                            <SelectContent>
                                {niftipayNetworks.map((n) => (
                                    <SelectItem key={`${n.chain}:${n.asset}`} value={`${n.chain}:${n.asset}`}>
                                        {n.label}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                )}
            </CardContent>
        </Card>
    );
}
