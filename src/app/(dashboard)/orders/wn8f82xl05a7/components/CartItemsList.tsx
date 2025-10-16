"use client";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { Minus, Plus, Trash2 } from "lucide-react";
import { OrderItem, Product } from "../types";
import { inCartQty, stockForCountry } from "../utils";
import { formatCurrency } from "@/lib/currency";

type Props = {
  items: OrderItem[];
  clientCountry: string;
  onUpdate: (productId: string, variationId: string | null, action: "add" | "subtract") => void;
  onRemove: (productId: string, variationId: string | null, idx: number) => void;
};

export function CartItemsList({ items, clientCountry, onUpdate, onRemove }: Props) {
  return (
    <div className="space-y-4 mb-4">
      {items.map(({ product, quantity }, idx) => {
        const price = product.price;
        const finite = Object.keys(product.stockData || {}).length > 0;
        const base = stockForCountry(product, clientCountry);
        const used = inCartQty(product.id, product.variationId ?? null, items);
        const remaining = Math.max(0, base - used);
        const disablePlus = finite && !product.allowBackorders && remaining === 0;

        return (
          <div key={`${product.id}:${product.variationId ?? "base"}`} className="flex items-center gap-4 p-4 border rounded-lg">
            <Image src={product.image} alt={product.title} width={80} height={80} className="rounded-md" />
            <div className="flex-1">
              <div className="flex justify-between">
                <h3 className="font-medium">{product.title}</h3>
                <Button variant="ghost" size="icon" onClick={() => onRemove(product.id, product.variationId ?? null, idx)}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
              <p className="text-sm text-muted-foreground">SKU: {product.sku}</p>
              <div className="flex items-center gap-2 mt-2">
                <Button variant="ghost" size="icon" onClick={() => onUpdate(product.id, product.variationId ?? null, "subtract")}><Minus className="h-4 w-4" /></Button>
                <span className="font-medium">{quantity}</span>
                <Button variant="ghost" size="icon" onClick={() => onUpdate(product.id, product.variationId ?? null, "add")} disabled={disablePlus} aria-disabled={disablePlus} title={disablePlus ? "Out of stock" : undefined}>
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
              <div className="flex justify-between mt-2">
                <span className="font-medium">Unit Price: {formatCurrency(price, clientCountry)}</span>
                <span className="font-medium">{formatCurrency(product.subtotal ?? price * quantity, clientCountry)}</span>
              </div>
              {!!Object.keys(product.stockData || {}).length && (
                <div className="mt-1 text-xs text-muted-foreground">
                  Stock in {clientCountry || "country"}: {remaining}
                  {remaining === 0 && product.allowBackorders ? " (backorder allowed)" : ""}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
