"use client";
import { Label } from "@/components/ui/label";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { ShippingCompany, ShippingMethod } from "../types";

type Props = {
    loading?: boolean;
    totalBefore: number;
    methods: ShippingMethod[];
    companies: ShippingCompany[];
    selectedMethod: string; setSelectedMethod: (v: string) => void;
    selectedCompany: string; setSelectedCompany: (v: string) => void;
};

export function ShippingSelector({
    loading, totalBefore,
    methods, companies, selectedMethod, setSelectedMethod, selectedCompany, setSelectedCompany,
}: Props) {
    return (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
                <Label>Method</Label>
                <Select value={selectedMethod} onValueChange={setSelectedMethod} disabled={loading}>
                    <SelectTrigger><SelectValue placeholder={loading ? "Loading…" : "Select method"} /></SelectTrigger>
                    <SelectContent>
                        {methods.map(m => {
                            const tier = m.costs.find(({ minOrderCost, maxOrderCost }) =>
                                totalBefore >= minOrderCost && (maxOrderCost === 0 || totalBefore <= maxOrderCost));
                            const cost = tier ? tier.shipmentCost : 0;
                            return (
                                <SelectItem key={m.id} value={m.id}>
                                    <span className="block max-w-[280px] truncate">{m.title} — {m.description} — ${cost.toFixed(2)}</span>
                                </SelectItem>
                            );
                        })}
                    </SelectContent>
                </Select>
            </div>

            <div>
                <Label>Company</Label>
                <Select value={selectedCompany} onValueChange={setSelectedCompany} disabled={loading}>
                    <SelectTrigger><SelectValue placeholder={loading ? "Loading…" : "Select company"} /></SelectTrigger>
                    <SelectContent>
                        {companies.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                    </SelectContent>
                </Select>
            </div>
        </div>
    );
}
