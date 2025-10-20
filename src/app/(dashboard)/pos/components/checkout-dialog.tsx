"use client";

import * as React from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";

type Discount = { type: "fixed" | "percentage"; value: number };

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  totalEstimate: number;
  cartId: string | null;
  clientId: string | null;
  registerId: string | null;
  storeId: string | null;
  discount: Discount;
  onComplete: (orderId: string, parked?: boolean) => void;
};

export default function CheckoutDialog({
  open,
  onOpenChange,
  totalEstimate,
  cartId,
  clientId,
  registerId,
  storeId,
  discount,
  onComplete,
}: Props) {
  const [note, setNote] = React.useState("");
  const [loading, setLoading] = React.useState<"pay" | "park" | null>(null);

  const disabled =
    !cartId || !clientId || !registerId || !storeId || totalEstimate < 0;

  async function doAction(park: boolean) {
    if (disabled) return;
    setLoading(park ? "park" : "pay");
    try {
      const body = {
        cartId,
        clientId,
        registerId,
        storeId,
        discount,
        note: note || undefined,
        parked: park,
      };

      // Try common POS endpoints (first one that exists will work)
      let res = await fetch(`/api/pos/cart/${cartId}/checkout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        res = await fetch(`/api/pos/checkout`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
      }

      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error || j?.message || "Checkout failed");
      }

      const j = await res.json();
      const orderId = j.orderId || j.order?.id || j.id;
      if (!orderId) throw new Error("No order id returned");

      onOpenChange(false);
      onComplete(orderId, park);
    } catch (e: any) {
      toast.error(e?.message || "Checkout failed");
    } finally {
      setLoading(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Checkout</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1">
            <div className="text-sm text-muted-foreground">Amount due</div>
            <div className="text-2xl font-bold">${totalEstimate.toFixed(2)}</div>
          </div>

          <Separator />

          <div className="space-y-2">
            <Label htmlFor="pos-note">Notes (optional)</Label>
            <Input
              id="pos-note"
              placeholder="Add a note for the order…"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <Button
              onClick={() => doAction(false)}
              disabled={disabled || loading !== null}
            >
              {loading === "pay" ? "Processing…" : "Complete sale"}
            </Button>
            <Button
              variant="outline"
              onClick={() => doAction(true)}
              disabled={disabled || loading !== null}
            >
              {loading === "park" ? "Parking…" : "Park order"}
            </Button>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
