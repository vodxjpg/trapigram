"use client";

import * as React from "react";
import { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  orderId: string | null;
  defaultEmail?: string;
};

export default function ReceiptOptionsDialog({
  open,
  onOpenChange,
  orderId,
  defaultEmail,
}: Props) {
  const [email, setEmail] = useState(defaultEmail || "");
  const [sending, setSending] = useState(false);
  const [order, setOrder] = useState<any | null>(null);

  // fetch order (for payment.splits + niftipay meta)
  useEffect(() => {
    let ignore = false;
    if (!open || !orderId) {
      setOrder(null);
      return;
    }
    (async () => {
      try {
        const r = await fetch(`/api/order/${orderId}`);
        const j = await r.json();
        if (!ignore) setOrder(j);
      } catch {
        // ignore
      }
    })();
    return () => {
      ignore = true;
    };
  }, [open, orderId]);

  /* ─────────────────────────────────────────────────────────────
   * Extract Niftipay meta + match to Niftipay splits by amount
   * (one QR/address block per split)
   * ──────────────────────────────────────────────────────────── */
  type NiftiView = {
    amount: number;
    asset?: string | null;
    chain?: string | null;
    address?: string | null;
    qr?: string | null; // url or data-uri
  };

  const niftiBlocks = useMemo(() => {
    if (!order) return [] as Array<NiftiView & { idx: number }>;

    const splits: Array<{ name: string; amount: number }> =
      order?.payment?.splits || [];
    const niftiSplits = splits
      .filter((s) => /niftipay/i.test(s.name || ""))
      .map((s) => ({ amount: Number(s.amount || 0) }));

    const metas: NiftiView[] = (() => {
      const arr: any[] = Array.isArray(order.orderMeta) ? order.orderMeta : [];
      const out: NiftiView[] = [];
      for (const m of arr) {
        // accept either a root object or an { order: {...} } envelope
        const node = m?.order ?? m ?? {};
        const amount = Number(node.amount ?? node.total ?? node.value ?? NaN);
        const asset = node.asset ?? node.assetSymbol ?? node.coin ?? null;
        const chain = node.network ?? node.chain ?? null;
        const address =
          node.walletAddress ??
          node.address ??
          node.publicAddress ??
          node.payToAddress ??
          null;
        const qr =
          node.qr ?? node.qrUrl ?? node.qrImageUrl ?? node.qrCodeUrl ?? null;

        if (Number.isFinite(amount) && (address || qr)) {
          out.push({ amount, asset, chain, address, qr });
        }
      }
      return out;
    })();

    // greedy match by amount so we show exactly one block per split
    const used = new Array(metas.length).fill(false);
    const blocks: Array<NiftiView & { idx: number }> = [];
    niftiSplits.forEach((s, idx) => {
      let pick = -1;
      for (let i = 0; i < metas.length; i++) {
        if (!used[i] && Math.abs(metas[i].amount - s.amount) < 0.0001) {
          pick = i;
          break;
        }
      }
      if (pick >= 0) {
        used[pick] = true;
        blocks.push({ ...metas[pick], idx });
      }
    });
    return blocks;
  }, [order]);

  /* ─────────────────────────────────────────────────────────────
   * Print / Email actions
   * ──────────────────────────────────────────────────────────── */
  const doPrint = async () => {
    try {
      // Many setups just open a printable route; adjust if needed
      window.open(`/pos/receipt/${orderId}?print=1`, "_blank", "noopener");
    } catch {
      toast.error("Unable to open printer view");
    }
  };

  const sendEmail = async () => {
    if (!orderId) return;
    if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
      toast.error("Enter a valid email");
      return;
    }
    setSending(true);
    try {
      const r = await fetch(`/api/receipts/email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId, email }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j?.error || j?.message || "Failed to email receipt");
      }
      toast.success("Receipt sent");
    } catch (e: any) {
      toast.error(e?.message || "Failed to email receipt");
    } finally {
      setSending(false);
    }
  };

  const close = () => onOpenChange(false);

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Copied to clipboard");
    } catch {
      toast.error("Could not copy");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Receipt options</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Niftipay QR/address blocks – one per split */}
          {niftiBlocks.length > 0 && (
            <div className="space-y-3">
              {niftiBlocks.map((b) => (
                <Card key={`nifti-${b.idx}`} className="p-3 space-y-2">
                  <div className="text-sm font-medium">
                    {b.asset ? `${b.asset}` : "Crypto"}
                    {b.chain ? ` on ${b.chain}` : ""} — {b.amount}
                  </div>

                  {b.qr && (
                    <img
                      src={b.qr}
                      alt="Payment QR"
                      className="mx-auto h-40 w-40 object-contain"
                    />
                  )}

                  {b.address && (
                    <div className="text-xs break-all rounded bg-muted p-2 font-mono">
                      {b.address}
                    </div>
                  )}

                  {b.address && (
                    <div className="flex justify-end">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => copy(b.address!)}
                      >
                        Copy address
                      </Button>
                    </div>
                  )}
                </Card>
              ))}
            </div>
          )}

          {/* Email field */}
          <div className="space-y-2">
            <Label htmlFor="receipt-email">Email (optional)</Label>
            <Input
              id="receipt-email"
              placeholder="customer@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              We’ll email a link to the receipt PDF. Leave blank to skip email.
            </p>
          </div>

          {/* Actions */}
          <div className="grid grid-cols-3 gap-2">
            <Button variant="outline" onClick={doPrint} disabled={!orderId}>
              Print
            </Button>
            <Button onClick={sendEmail} disabled={!orderId || !email || sending}>
              {sending ? "Sending…" : "Email"}
            </Button>
            <Button variant="ghost" onClick={close}>
              Skip
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
