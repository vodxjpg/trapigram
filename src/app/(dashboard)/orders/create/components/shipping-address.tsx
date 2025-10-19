// components/ShippingAddress.tsx
"use client";

import { Truck } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export interface ShippingAddressProps {
    orderGenerated: boolean;
    addresses: Array<{ id: string; clientId: string; address: string }>;
    selectedAddressId: string;
    setSelectedAddressId: (id: string) => void;
    newAddress: string;
    setNewAddress: (v: string) => void;
    addAddress: () => void | Promise<void>;
}

export default function ShippingAddress(props: ShippingAddressProps) {
    const {
        orderGenerated,
        addresses,
        selectedAddressId,
        setSelectedAddressId,
        newAddress,
        setNewAddress,
        addAddress,
    } = props;

    if (!orderGenerated) return null;

    return (
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    <Truck className="h-5 w-5" /> Shipping Address
                </CardTitle>
            </CardHeader>
            <CardContent>
                {addresses.length > 0 && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {addresses.map((addr) => (
                            <label key={addr.id} className="flex items-center gap-2">
                                <input
                                    type="radio"
                                    name="address"
                                    className="h-4 w-4"
                                    value={addr.id}
                                    checked={selectedAddressId === addr.id}
                                    onChange={() => setSelectedAddressId(addr.id)}
                                />
                                <span className="font-medium">{addr.address}</span>
                            </label>
                        ))}
                    </div>
                )}

                <Separator className="my-4" />

                <div className="flex gap-4">
                    <div className="flex-1">
                        <Label>Address</Label>
                        <Input
                            value={newAddress}
                            onChange={(e) => setNewAddress(e.target.value)}
                            placeholder="123 Main St."
                        />
                    </div>
                    <div className="flex items-end">
                        <Button onClick={addAddress} disabled={!newAddress}>
                            Add Address
                        </Button>
                    </div>
                </div>
            </CardContent>
        </Card>
    );
}
