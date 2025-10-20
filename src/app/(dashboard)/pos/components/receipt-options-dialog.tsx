// src/app/(dashboard)/pos/components/receipt-options-dialog.tsx
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

type NiftiView = {
  amount: number;
  asset?: string | null;
  chain?: string | null;
  address?: string | null;
  qr?: string | null; // url or data-uri
};

function looksNiftipayName(s?: string | null) {
  return !!s && /niftipay/i.test(s);
}

export default function ReceiptOptionsDialog({
  open,
  onOpenChange,
  orderId,
  defaultEmail,
}: Props) {
  const [email, setEmail] = useState(defaultEmail || "");
  const [sending, setSending] = useState(false);

  // we keep both the raw payload and a normalized "order-ish" object
  const [raw, setRaw] = useState<any | null>(null);
  const [order, setOrder] = useState<any | null>(null);

  // fetch order (for payments + niftipay meta)
  useEffect(() => {
    let ignore = false;
    if (!open || !orderId) {
      setRaw(null);
      setOrder(null);
      return;
    }
    (async () => {
      try {
        // Most backends expose /api/orders/:id (plural). Fall back to /api/order/:id if needed.
        const endpoints = [`/api/orders/${orderId}`, `/api/order/${orderId}`];
        let data: any = null;
        for (const url of endpoints) {
          try {
            const r = await fetch(url, { cache: "no-store" });
            if (r.ok) {
              data = await r.json().catch(() => ({}));
              break;
            }
          } catch { /* try next */ }
        }
        if (!data) throw new Error("Could not load order");
        if (ignore) return;

        // Accept a few common shapes: { order, payment }, { order }, or the order itself.
        const ord =
          data?.order ??
          data?.data ??
          (data?.id ? data : null);

        setRaw(data);
        setOrder(ord);
      } catch {
        if (!ignore) {
          setRaw(null);
          setOrder(null);
        }
      }
    })();
    return () => {
      ignore = true;
    };
  }, [open, orderId]);

  /* ─────────────────────────────────────────────────────────────
   * Extract Niftipay meta + match to Niftipay splits by amount
   *  - We’re generous with shapes so it “just works”.
   *  - If no splits are found, we’ll still show all meta blocks.
   * ──────────────────────────────────────────────────────────── */
  const niftiBlocks = useMemo(() => {
    if (!raw && !order) return [] as Array<NiftiView & { idx: number }>;

    // 1) find splits from a few likely places
    const splitsFromRaw =
      raw?.payment?.splits ??
      raw?.order?.payment?.splits ??
      raw?.orderPayments ??
      raw?.payments ??
      [];

    const splitsFromOrder =
      order?.payment?.splits ??
      order?.orderPayments ??
      order?.payments ??
      [];

    // normalize splits to { name?: string; amount: number }
    const toSplit = (x: any) => {
      if (!x) return null;
      const name =
        x.name ?? x.methodName ?? x.method ?? x.methodId ?? x.id ?? null;
      const amount = Number(x.amount ?? x.value ?? x.total ?? NaN);
      if (!Number.isFinite(amount)) return null;
      return { name: name ? String(name) : null, amount };
    };

    const splits = [...splitsFromRaw, ...splitsFromOrder]
      .map(toSplit)
      .filter(Boolean) as { name: string | null; amount: number }[];

    const niftiSplits =
      splits.filter((s) => looksNiftipayName(s.name)) ||
      [];

    // 2) extract niftipay-ish meta from orderMeta in a forgiving way
    const metaArray: any[] = Array.isArray(order?.orderMeta)
      ? order!.orderMeta
      : Array.isArray(raw?.orderMeta)
      ? raw!.orderMeta
      : Array.isArray(raw?.order?.orderMeta)
      ? raw!.order.orderMeta
      : [];

    const metas: NiftiView[] = [];
    for (const m of metaArray) {
      // accept root or { order: ... }
      const node = m?.order ?? m ?? {};
      // accept a few common keys
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
        node.qr ??
        node.qrUrl ??
        node.qrImageUrl ??
        node.qrCodeUrl ??
        null;

      // If this meta has something we can display, keep it.
      if (Number.isFinite(amount) && (address || qr)) {
        metas.push({ amount, asset, chain, address, qr });
      }
    }

    if (!metas.length) return [];

    // 3) If we have niftipay splits, greedily match by amount (so exactly one block per split).
    if (niftiSplits.length) {
      const used = new Array(metas.length).fill(false);
      const out: Array<NiftiView & { idx: number }> = [];
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
          out.push({ ...metas[pick], idx });
        }
      });
      if (out.length) return out;
    }

    // 4) Fallback: show all niftipay-looking meta blocks (even if we can’t see splits)
    return metas.map((m, i) => ({ ...m, idx: i }));
  }, [raw, order]);

  /* ─────────────────────────────────────────────────────────────
   * Print / Email actions
   * ──────────────────────────────────────────────────────────── */
  const doPrint = async () => {
    try {
      if (!orderId) return;
      // Open the actual PDF API route (the previous page URL was 404)
      window.open(`/api/pos/receipts/${orderId}/pdf`, "_blank", "noopener");
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
          {/* Niftipay QR/address blocks – robust extraction */}
          {niftiBlocks.length > 0 && (
            <div className="space-y-3">
              {niftiBlocks.map((b) => (
                <Card key={`nifti-${b.idx}`} className="p-3 space-y-2">
                  <div className="text-sm font-medium">
                    {b.asset ? `${b.asset}` : "Crypto"}
                    {b.chain ? ` on ${b.chain}` : ""} — {b.amount}
                  </div>

                  {b.qr && (
                    // eslint-disable-next-line @next/next/no-img-element
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
