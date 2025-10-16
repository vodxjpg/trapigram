"use client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Address } from "../types";

type Props = {
    addresses: Address[];
    selectedAddressId: string;
    setSelectedAddressId: (v: string) => void;
    newAddress: string; setNewAddress: (v: string) => void;
    onAddAddress: () => void;
};

export function AddressSection({ addresses, selectedAddressId, setSelectedAddressId, newAddress, setNewAddress, onAddAddress }: Props) {
    return (
        <div>
            {addresses.length > 0 && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {addresses.map((addr) => (
                        <label key={addr.id} className="flex items-center gap-2">
                            <input type="radio" name="address" className="h-4 w-4" value={addr.id}
                                checked={selectedAddressId === addr.id} onChange={() => setSelectedAddressId(addr.id)} />
                            <span className="font-medium">{addr.address}</span>
                        </label>
                    ))}
                </div>
            )}
            <Separator className="my-4" />
            <div className="flex gap-4">
                <div className="flex-1">
                    <Label>Address</Label>
                    <Input value={newAddress} onChange={(e) => setNewAddress(e.target.value)} placeholder="123 Main St." />
                </div>
                <div className="flex items-end">
                    <Button onClick={onAddAddress} disabled={!newAddress}>Add Address</Button>
                </div>
            </div>
        </div>
    );
}
