"use client";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectGroup, SelectLabel, SelectItem, SelectSeparator } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Search, Plus } from "lucide-react";
import { Product } from "../types";
import { tokenOf } from "../utils";

type Props = {
    disabled?: boolean;
    products: Product[];
    productsLoading: boolean;
    clientCountry: string;
    orderItems: any[];
    selectedProduct: string;
    setSelectedProduct: (v: string) => void;
    quantityText: string;
    setQuantityText: (v: string) => void;
    addProduct: () => void;

    // minimal helpers
    groupByCategory: (arr: Product[]) => Array<[string, Product[]]>;
    stockLeft: (p: Product) => { remaining: number; hasFinite: boolean; disabled: boolean };
};

export function ProductSelect({
    disabled, productsLoading, products, clientCountry, selectedProduct, setSelectedProduct,
    quantityText, setQuantityText, addProduct, groupByCategory, stockLeft
}: Props) {
    return (
        <div className="space-y-4">
            <div className="flex flex-col sm:flex-row gap-4">
                <div className="flex-1">
                    <Label>Select Product</Label>
                    <Select value={selectedProduct} onValueChange={setSelectedProduct} disabled={disabled || productsLoading}>
                        <SelectTrigger><SelectValue placeholder={productsLoading ? "Loading…" : "Select a product"} /></SelectTrigger>
                        <SelectContent className="w-[500px]">
                            <div className="p-3 border-b flex items-center gap-2">
                                <Search className="h-4 w-4 text-muted-foreground" />
                                <Input placeholder="Type in the main search from your container page" className="h-8" />
                            </div>
                            <ScrollArea className="max-h-72">
                                {groupByCategory(products.filter(p => !p.isAffiliate)).map(([label, items]) => (
                                    <SelectGroup key={label}>
                                        <SelectLabel>{label}</SelectLabel>
                                        {items.map(p => {
                                            console.log(p, clientCountry)
                                            const price = p.regularPrice[clientCountry] ?? p.price;
                                            const { remaining, hasFinite, disabled } = stockLeft(p);
                                            return (
                                                <SelectItem key={tokenOf(p)} value={tokenOf(p)} disabled={disabled}>
                                                    <span className="block max-w-[420px] truncate">
                                                        {p.title} — ${price}
                                                        {hasFinite && <span className="ml-2 text-xs text-muted-foreground">Stock: {remaining}{disabled ? " (out of stock)" : ""}</span>}
                                                    </span>
                                                </SelectItem>
                                            );
                                        })}
                                        <SelectSeparator />
                                    </SelectGroup>
                                ))}
                                {products.some(p => p.isAffiliate) && (
                                    <SelectGroup>
                                        <SelectLabel>Affiliate</SelectLabel>
                                        {products.filter(p => p.isAffiliate).map(p => (
                                            <SelectItem key={tokenOf(p)} value={tokenOf(p)}>
                                                {p.title} — {p.price} pts
                                            </SelectItem>
                                        ))}
                                    </SelectGroup>
                                )}
                            </ScrollArea>
                        </SelectContent>
                    </Select>
                </div>

                <div className="w-24">
                    <Label>Quantity</Label>
                    <Input type="number" min={1} inputMode="numeric" pattern="[0-9]*"
                        value={quantityText}
                        onChange={(e) => setQuantityText(e.target.value.replace(/[^0-9]/g, ""))}
                        onBlur={() => setQuantityText(String(Math.max(1, parseInt(quantityText || "1", 10))))}
                    />
                </div>

                <div className="flex items-end">
                    <Button onClick={addProduct} disabled={!selectedProduct}>
                        <Plus className="h-4 w-4 mr-2" /> Add Product
                    </Button>
                </div>
            </div>
        </div>
    );
}
