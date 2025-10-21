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

/* ───────────────────────────────────────────────────────────── */

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

type NiftipayNet = { chain: string; asset: string; label: string };

function looksNiftipayName(s?: string | null) {
  return !!s && /niftipay/i.test(s);
}

const EURO = ["AT","BE","HR","CY","EE","FI","FR","DE","GR","IE","IT","LV","LT","LU","MT","NL","PT","SK","SI","ES"];
const currencyFromCountry = (c?: string) =>
  c === "GB" ? "GBP" : (c && EURO.includes(c)) ? "EUR" : "USD";

/* small helper for noisy console + safe json */
async function fetchJsonVerbose(url: string, opts: RequestInit = {}, tag = url) {
  const res = await fetch(url, { ...opts });
  let body: any = null;
  try { body = await res.clone().json(); } catch {}
  // eslint-disable-next-line no-console
  console.log(`[${tag}]`, res.status, body ?? "(non-json)");
  return res;
}

/** Try to pull customer name/email from any shape the order/raw may have. */
function extractCustomer(order: any, raw: any): { firstName: string; lastName: string; email?: string | null } {
  const candidates = [
    order,
    raw?.order,
    raw,
    order?.client,
    raw?.client,
    raw?.order?.client,
    order?.customer,
    raw?.customer,
    raw?.order?.customer,
  ].filter(Boolean);

  const get = (obj: any, keys: string[]) => {
    for (const k of keys) {
      const v = obj?.[k];
      if (typeof v === "string" && v.trim()) return v.trim();
    }
    return null;
  };

  let first = null as string | null;
  let last  = null as string | null;
  let email = null as string | null;

  for (const n of candidates) {
    if (!first) first = get(n, ["firstName","givenName","given_name","fname","first"]);
    if (!last)  last  = get(n, ["lastName","familyName","family_name","lname","last","surname"]);
    if (!email) email = get(n, ["email","emailAddress","mail"]);
    if (first && last && email) break;
  }

  // Try splitting a full name if present
  if ((!first || !last) && candidates.length) {
    const full = get(candidates[0], ["name","fullName","customerName","clientName"]);
    if (full) {
      const parts = full.split(/\s+/).filter(Boolean);
      if (parts.length === 1) first ??= parts[0];
      if (parts.length >= 2) {
        first ??= parts.slice(0, parts.length - 1).join(" ");
        last  ??= parts[parts.length - 1];
      }
    }
  }

  return {
    firstName: first || "POS",
    lastName:  last  || "Customer",
    email
  };
}

export default function ReceiptOptionsDialog({
  open,
  onOpenChange,
  orderId,
  defaultEmail,
}: Props) {
  const [email, setEmail] = useState(defaultEmail || "");
  const [sending, setSending] = useState(false);

  // raw payload + normalized order
  const [raw, setRaw] = useState<any | null>(null);
  const [order, setOrder] = useState<any | null>(null);

  // Niftipay networks (via backend proxy)
  const [niftipayNetworks, setNiftipayNetworks] = useState<NiftipayNet[]>([]);
  const [niftipayLoading, setNiftipayLoading] = useState(false);

  // ─────────────────────────────────────────────────────────────
  // 1) Fetch order (plural → singular fallback)
  useEffect(() => {
    let ignore = false;
    if (!open || !orderId) {
      setRaw(null);
      setOrder(null);
      return;
    }
    (async () => {
      try {
        const endpoints = [`/api/orders/${orderId}`, `/api/order/${orderId}`];
        let data: any = null;
        for (const url of endpoints) {
          try {
            const r = await fetch(url, { cache: "no-store" });
            if (r.ok) { data = await r.json().catch(() => ({})); break; }
          } catch {}
        }
        if (!data) throw new Error("Could not load order");
        if (ignore) return;

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
    return () => { ignore = true; };
  }, [open, orderId]);

  // 2) Load Niftipay networks via backend proxy
  useEffect(() => {
    if (!open) return;
    (async () => {
      setNiftipayLoading(true);
      try {
        const r = await fetch("/api/niftipay/payment-methods");
        if (!r.ok) throw new Error();
        const { methods } = await r.json();
        const nets: NiftipayNet[] = (methods || []).map((m: any) => ({
          chain: m.chain,
          asset: m.asset,
          label: m.label ?? `${m.asset} on ${m.chain}`,
        }));
        setNiftipayNetworks(nets);
      } catch {
        setNiftipayNetworks([]);
      } finally {
        setNiftipayLoading(false);
      }
    })();
  }, [open]);

  // ─────────────────────────────────────────────────────────────
  // 3) Ensure a Niftipay invoice exists (browser → our proxy → Niftipay)
  useEffect(() => {
    if (!open || !order) return;

    (async () => {
      try {
        // Pull splits from a few places
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

        const toSplit = (x: any) => {
          if (!x) return null;
          const name = x.name ?? x.methodName ?? x.method ?? x.methodId ?? x.id ?? null;
          const amount = Number(x.amount ?? x.value ?? x.total ?? NaN);
          if (!Number.isFinite(amount)) return null;
          return { name: name ? String(name) : null, amount };
        };

        const splits = [...splitsFromRaw, ...splitsFromOrder]
          .map(toSplit)
          .filter(Boolean) as { name: string | null; amount: number }[];

        const niftiSplits = splits.filter((s) => looksNiftipayName(s.name));
        if (!niftiSplits.length) return; // nothing to do in this receipt

        const niftiAmount = +niftiSplits.reduce((s, p) => s + p.amount, 0).toFixed(2);
        if (!(niftiAmount > 0)) return;

        // If orderMeta already has a valid QR/address for this amount, reuse it and stop.
        const metaArray: any[] = Array.isArray(order?.orderMeta)
          ? order!.orderMeta
          : Array.isArray(raw?.orderMeta)
          ? raw!.orderMeta
          : Array.isArray(raw?.order?.orderMeta)
          ? raw!.order.orderMeta
          : [];

        const metaHasInvoice = metaArray.some((m) => {
          const node = m?.order ?? m ?? {};
          const amount = Number(node.amount ?? node.total ?? node.value ?? NaN);
          const address =
            node.walletAddress ?? node.address ?? node.publicAddress ?? node.payToAddress ?? null;
          const qr = node.qr ?? node.qrUrl ?? node.qrImageUrl ?? node.qrCodeUrl ?? null;
          return Number.isFinite(amount) && Math.abs(amount - niftiAmount) < 0.0001 && (address || qr);
        });
        if (metaHasInvoice) return;

        // 3a) Try find existing invoice by reference via our proxy
        const ref = order.orderKey ?? order.id;
        const findRes = await fetchJsonVerbose(
          `/api/niftipay/orders?reference=${encodeURIComponent(ref)}`,
          { cache: "no-store" },
          "Niftipay FIND via proxy (POS receipt)"
        );

        if (findRes.ok) {
          const { orders: found = [] } = await findRes.clone().json().catch(() => ({ orders: [] }));
          const existing = found.find((o: any) => o.reference === ref && o.status !== "cancelled");
          if (existing) {
            // Attach to local state so the QR renders (no need to persist for this flow)
            setOrder((prev: any) => ({
              ...prev,
              orderMeta: [...(Array.isArray(prev?.orderMeta) ? prev.orderMeta : []), existing],
            }));
            return;
          }
        }

        // 3b) Create a new invoice via our proxy (pick a network/asset if we can)
        let chain: string | null = null;
        let asset: string | null = null;
        const fromMeta = metaArray
          .map((m) => m?.order ?? m ?? {})
          .find((n) => n.network && n.asset);
        if (fromMeta) {
          chain = fromMeta.network;
          asset = fromMeta.asset;
        } else if (niftipayNetworks.length) {
          chain = niftipayNetworks[0].chain;
          asset = niftipayNetworks[0].asset;
        }

        if (!chain || !asset) {
          if (!niftipayLoading) toast.error("No Niftipay networks available");
          return;
        }

        const currency = currencyFromCountry(order.country);
        const { firstName, lastName, email: orderEmail } = extractCustomer(order, raw);

        const niftipayRes = await fetch(`/api/niftipay/orders?replaceCancelled=1`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            network: chain,
            asset,
            amount: niftiAmount,
            currency,
            firstName,                 // ← now sending names
            lastName,                  // ← now sending names
            email: orderEmail || "user@trapyfy.com",
            merchantId: order.organizationId ?? undefined,
            reference: ref,
          }),
        });

        if (!niftipayRes.ok) {
          const errorBody = await niftipayRes.json().catch(() => ({ error: "Unknown error" }));
          toast.error(errorBody?.error || "Failed to create Niftipay invoice");
          return;
        }

        const niftipayMeta = await niftipayRes.json();
        // Attach to local order so QR renders
        setOrder((prev: any) => ({
          ...prev,
          orderMeta: [...(Array.isArray(prev?.orderMeta) ? prev.orderMeta : []), niftipayMeta],
        }));
      } catch (e: any) {
        toast.error(e?.message || "Niftipay invoice create/fetch failed");
      }
    })();
  }, [open, order, raw, niftipayNetworks, niftipayLoading]);

  /* ─────────────────────────────────────────────────────────────
   * Build blocks from whatever meta we now have
   * ──────────────────────────────────────────────────────────── */
  const niftiBlocks = useMemo(() => {
    if (!raw && !order) return [] as Array<NiftiView & { idx: number }>;

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

    const niftiSplits = splits.filter((s) => looksNiftipayName(s.name));

    const metaArray: any[] = Array.isArray(order?.orderMeta)
      ? order!.orderMeta
      : Array.isArray(raw?.orderMeta)
      ? raw!.orderMeta
      : Array.isArray(raw?.order?.orderMeta)
      ? raw!.order.orderMeta
      : [];

    const metas: NiftiView[] = [];
    for (const m of metaArray) {
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
        node.qr ??
        node.qrUrl ??
        node.qrImageUrl ??
        node.qrCodeUrl ??
        null;

      if (Number.isFinite(amount) && (address || qr)) {
        metas.push({ amount, asset, chain, address, qr });
      }
    }
    if (!metas.length) return [];

    if (niftiSplits.length) {
      const used = new Array(metas.length).fill(false);
      const out: Array<NiftiView & { idx: number }> = [];
      niftiSplits.forEach((s, idx) => {
        let pick = -1;
        for (let i = 0; i < metas.length; i++) {
          if (!used[i] && Math.abs(metas[i].amount - s.amount) < 0.0001) {
            pick = i; break;
          }
        }
        if (pick >= 0) { used[pick] = true; out.push({ ...metas[pick], idx }); }
      });
      if (out.length) return out;
    }

    return metas.map((m, i) => ({ ...m, idx: i }));
  }, [raw, order]);

  /* ─────────────────────────────────────────────────────────────
   * Print / Email actions
   * ──────────────────────────────────────────────────────────── */
  const doPrint = async () => {
    try {
      if (!orderId) return;
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
          {/* Niftipay QR/address blocks (from ensured invoice) */}
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
                      <Button variant="outline" size="sm" onClick={() => copy(b.address!)}>
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
