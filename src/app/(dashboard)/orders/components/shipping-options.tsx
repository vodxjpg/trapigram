// components/ShippingOptions.tsx
"use client";

import { Truck } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export interface ShippingOptionsProps {
    orderGenerated: boolean;
    shippingLoading: boolean;
    shippingMethods: {
        id: string;
        title: string;
        description: string;
        costs: Array<{ minOrderCost: number; maxOrderCost: number; shipmentCost: number }>;
    }[];
    selectedShippingMethod: string;
    setSelectedShippingMethod: (id: string) => void;

    shippingCompanies: { id: string; name: string }[];
    selectedShippingCompany: string;
    setSelectedShippingCompany: (id: string) => void;

    /** Total BEFORE shipping (used to pick cost tier) */
    totalBeforeShipping: number;
}

export default function ShippingOptions(props: ShippingOptionsProps) {
    const {
        orderGenerated,
        shippingLoading,
        shippingMethods,
        selectedShippingMethod,
        setSelectedShippingMethod,
        shippingCompanies,
        selectedShippingCompany,
        setSelectedShippingCompany,
        totalBeforeShipping,
    } = props;

    return (
        <Card className={!orderGenerated ? "opacity-50 pointer-events-none" : ""}>
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    <Truck className="h-5 w-5" /> Shipping
                </CardTitle>
            </CardHeader>
            <CardContent>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {/* Method */}
                    <div>
                        <Label>Method</Label>
                        <Select
                            value={selectedShippingMethod}
                            onValueChange={setSelectedShippingMethod}
                            disabled={!orderGenerated || shippingLoading}
                        >
                            <SelectTrigger>
                                <SelectValue placeholder={shippingLoading ? "Loading…" : "Select method"} />
                            </SelectTrigger>
                            <SelectContent>
                                {shippingMethods.map((m) => {
                                    const tier = m.costs.find(
                                        ({ minOrderCost, maxOrderCost }) =>
                                            totalBeforeShipping >= minOrderCost &&
                                            (maxOrderCost === 0 || totalBeforeShipping <= maxOrderCost)
                                    );
                                    const cost = tier ? tier.shipmentCost : 0;

                                    return (
                                        <SelectItem key={m.id} value={m.id}>
                                            <span className="block max-w-[280px] truncate">
                                                {m.title} — {m.description} — ${cost.toFixed(2)}
                                            </span>
                                        </SelectItem>
                                    );
                                })}
                            </SelectContent>
                        </Select>
                    </div>

                    {/* Company */}
                    <div>
                        <Label>Company</Label>
                        <Select
                            value={selectedShippingCompany}
                            onValueChange={setSelectedShippingCompany}
                            disabled={!orderGenerated || shippingLoading}
                        >
                            <SelectTrigger>
                                <SelectValue placeholder={shippingLoading ? "Loading…" : "Select company"} />
                            </SelectTrigger>
                            <SelectContent>
                                {shippingCompanies.map((c) => (
                                    <SelectItem key={c.id} value={c.id}>
                                        {c.name}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                </div>
            </CardContent>
        </Card>
    );
}
