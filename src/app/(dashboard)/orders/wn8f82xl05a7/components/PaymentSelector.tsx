"use client";
import { Label } from "@/components/ui/label";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { PaymentMethod, NiftipayNet } from "../types";

type Props = {
    disabled?: boolean;
    methods: PaymentMethod[];
    selected: string; setSelected: (v: string) => void;
    niftipayNetworks: NiftipayNet[];
    niftipayLoading: boolean;
    selectedNifti: string; setSelectedNifti: (v: string) => void;
};

export function PaymentSelector({
    disabled, methods, selected, setSelected, niftipayNetworks, niftipayLoading, selectedNifti, setSelectedNifti,
}: Props) {
    const selectedPm = methods.find(p => p.id === selected);
    const isNiftipay = !!selectedPm && /niftipay/i.test(selectedPm.name || "");

    return (
        <div>
            <Label htmlFor="payment">Select Payment Method</Label>
            <Select value={selected} onValueChange={setSelected} disabled={disabled}>
                <SelectTrigger id="payment"><SelectValue placeholder="Select a payment method" /></SelectTrigger>
                <SelectContent>
                    {methods.map(m => <SelectItem key={m.id} value={m.id}>{m.name}{m.active === false ? " (inactive)" : ""}</SelectItem>)}
                </SelectContent>
            </Select>

            {isNiftipay && (
                <div className="mt-4">
                    <Label>Select Crypto Network</Label>
                    <Select value={selectedNifti} onValueChange={setSelectedNifti} disabled={niftipayLoading}>
                        <SelectTrigger><SelectValue placeholder={niftipayLoading ? "Loading…" : "Select network"} /></SelectTrigger>
                        <SelectContent>
                            {niftipayNetworks.map(n => (
                                <SelectItem key={`${n.chain}:${n.asset}`} value={`${n.chain}:${n.asset}`}>{n.label}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
            )}
        </div>
    );
}
