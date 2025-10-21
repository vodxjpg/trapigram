// src/app/(dashboard)/pos/components/checkout-dialog.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { PauseCircle, Check, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

type PaymentMethodRow = {
  id: string;
  name: string;
  description?: string | null;
  instructions?: string | null;
};

type Payment = { methodId: string; amount: number };
type DiscountPayload = { type: "fixed" | "percentage"; value: number };
type NiftipayNet = { chain: string; asset: string; label: string };

type CheckoutDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  totalEstimate: number;
  cartId: string | null;
  clientId: string | null;
  registerId: string | null;
  storeId: string | null;
  onComplete: (orderId: string, parked?: boolean) => void;
  /** Optional POS discount to apply as coupon "POS" */
  discount?: DiscountPayload;
};

function toMoney(n: number) {
  // avoid float noise
  return +n.toFixed(2);
}

export function CheckoutDialog(props: CheckoutDialogProps) {
  const {
    open,
    onOpenChange,
    totalEstimate,
    cartId,
    clientId,
    registerId,
    storeId,
    onComplete,
    discount,
  } = props;

  const [paymentMethods, setPaymentMethods] = useState<PaymentMethodRow[]>([]);
  const [currentMethodId, setCurrentMethodId] = useState<string | null>(null);

  const [payments, setPayments] = useState<Payment[]>([]);
  const [currentAmount, setCurrentAmount] = useState("");
  const [cashReceived, setCashReceived] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── Niftipay network state ─────────────────────────────────────────
  const [niftipayNetworks, setNiftipayNetworks] = useState<NiftipayNet[]>([]);
  const [niftipayLoading, setNiftipayLoading] = useState(false);
  const [selectedNiftipay, setSelectedNiftipay] = useState(""); // "chain:asset"

  const totalPaid = useMemo(() => payments.reduce((s, p) => s + p.amount, 0), [payments]);
  const remaining = Math.max(0, toMoney(totalEstimate - totalPaid));

  // Show cash "received / change" helper if selected method name mentions cash
  const currentIsCash = useMemo(() => {
    const m = paymentMethods.find((pm) => pm.id === currentMethodId);
    return (m?.name || "").toLowerCase().includes("cash");
  }, [paymentMethods, currentMethodId]);

  const change =
    currentIsCash && cashReceived
      ? Math.max(0, Number.parseFloat(cashReceived) - (Number.parseFloat(currentAmount || "0") || 0))
      : 0;

  // Reset lightweight state on close; keep loaded methods cached
  useEffect(() => {
    if (!open) {
      setPayments([]);
      setCurrentAmount("");
      setCashReceived("");
      setBusy(false);
      setError(null);
      setSelectedNiftipay("");
    }
  }, [open]);

  // Fetch niftipay networks available for the user
  async function fetchNiftipayNetworks(): Promise<NiftipayNet[]> {
    const r = await fetch("/api/niftipay/payment-methods");
    if (!r.ok) throw new Error(await r.text().catch(() => "Niftipay methods failed"));
    const { methods } = await r.json();
    return (methods || []).map((m: any) => ({
      chain: m.chain,
      asset: m.asset,
      label: m.label ?? `${m.asset} on ${m.chain}`,
    }));
  }

  // Load active payment methods when dialog opens (with resilient field names + a safe fallback)
  useEffect(() => {
    if (!open || !cartId) return;
    let ignore = false;
    (async () => {
      try {
        const res = await fetch(`/api/pos/checkout?cartId=${encodeURIComponent(cartId)}`);
        const j = await res.json().catch(() => ({} as any));
        if (!res.ok) throw new Error(j?.error || "Failed to load payment methods");

        // Accept several possible shapes
        const raw: any[] =
          j?.paymentMethods ??
          j?.methods ??
          j?.data ??
          [];

        const methods: PaymentMethodRow[] = raw
          .map((m) => ({
            id: String(m.id ?? m.methodId ?? m.key ?? ""),
            name: String(m.name ?? m.title ?? "Method"),
            description: m.description ?? null,
            instructions: m.instructions ?? null,
          }))
          .filter((m) => m.id);

        // Fallback if API returned nothing
        const safe = methods.length
          ? methods
          : ([
              { id: "cash", name: "Cash" },
              { id: "card", name: "Card" },
            ] satisfies PaymentMethodRow[]);

        if (!ignore) {
          setPaymentMethods(safe);
          if (!currentMethodId && safe[0]) setCurrentMethodId(safe[0].id);
        }
      } catch (e: any) {
        if (!ignore) {
          // still allow user to record at least cash
          setPaymentMethods([
            { id: "cash", name: "Cash" },
            { id: "card", name: "Card" },
          ]);
          if (!currentMethodId) setCurrentMethodId("cash");
          setError(e?.message || "Failed to load payment methods");
        }
      }
    })();
    return () => {
      ignore = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, cartId]);

    // When Niftipay is among methods, fetch its networks
  useEffect(() => {
    if (!open) return;
    const hasNifti = paymentMethods.some((m) => /niftipay/i.test(m.name || ""));
    if (!hasNifti) {
      setNiftipayNetworks([]);
      setSelectedNiftipay("");
      return;
    }
    (async () => {
      setNiftipayLoading(true);
      try {
        const nets = await fetchNiftipayNetworks();
        setNiftipayNetworks(nets);
        if (!selectedNiftipay && nets[0]) {
          setSelectedNiftipay(`${nets[0].chain}:${nets[0].asset}`);
        }
      } catch {
        setNiftipayNetworks([]);
        setSelectedNiftipay("");
      } finally {
        setNiftipayLoading(false);
      }
    })();
  }, [open, paymentMethods, selectedNiftipay]);

  const currentMethodIsNiftipay = useMemo(() => {
    const m = paymentMethods.find((pm) => pm.id === currentMethodId);
    return !!m && /niftipay/i.test(m.name || "");
  }, [paymentMethods, currentMethodId]);

  // If there is any Niftipay split in the list, require a selected network
  const niftiInPayments = useMemo(() => {
    return payments.some((p) => {
      const name = paymentMethods.find((pm) => pm.id === p.methodId)?.name || "";
      return /niftipay/i.test(name);
    });
  }, [payments, paymentMethods]);
  const niftiSelectionRequired = niftiInPayments && niftipayNetworks.length > 0 && !selectedNiftipay;

  /* ───────────────────────── Split helpers ───────────────────────── */
  const handleAddPayment = () => {
    const amount = Number.parseFloat(currentAmount);
    if (!currentMethodId) return;
    if (!Number.isFinite(amount) || amount <= 0) return;
    if (amount > remaining) return;
    if (currentMethodIsNiftipay && niftipayNetworks.length > 0 && !selectedNiftipay) return;

    setPayments((prev) => {
      const idx = prev.findIndex((p) => p.methodId === currentMethodId);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = { ...next[idx], amount: toMoney(next[idx].amount + amount) };
        return next;
      }
      return [...prev, { methodId: currentMethodId, amount: toMoney(amount) }];
    });
    setCurrentAmount("");
    setCashReceived("");
  };

  const handleQuickAmount = (fraction: number) => {
    const v = Math.max(0, remaining * fraction);
    const s = v.toFixed(2);
    setCurrentAmount(s);
    if (currentIsCash) setCashReceived(s);
  };

  const removePayment = (methodId: string) => {
    setPayments((prev) => prev.filter((p) => p.methodId !== methodId));
  };

  /* ───────────────────────── Submit actions ───────────────────────── */

  // ✅ Parking with a remaining balance is allowed (like before)
  const submitParkedCheckout = async () => {
    if (!cartId || !clientId || !registerId) {
      setError("Missing cart, customer or outlet.");
      return;
    }
    try {
      setBusy(true);
      const idem =
        ((globalThis.crypto as any)?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`) as string;

      const payload: {
        cartId: string;
        payments: Payment[];
        storeId: string | null;
        registerId: string | null;
        discount?: DiscountPayload;
        parked: boolean;
        niftipay?: { chain: string; asset: string; amount: number } | undefined;
      } = {
        cartId,
        payments, // can be empty or partial; backend records partials and leaves a balance due
        storeId,
        registerId,
        parked: true,
      };

      if (discount && Number.isFinite(discount.value) && discount.value > 0) {
        payload.discount = discount;
      }

      // If any Niftipay split, include the chosen chain/asset + split amount
      const niftiAmount = payments
        .filter(p => /niftipay/i.test(paymentMethods.find(pm => pm.id === p.methodId)?.name || ""))
        .reduce((s, p) => s + p.amount, 0);

      if (niftiAmount > 0 && selectedNiftipay) {
        const [chain, asset] = selectedNiftipay.split(":");
        (payload as any).niftipay = { chain, asset, amount: toMoney(niftiAmount) };
      }


      const res = await fetch("/api/pos/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": idem },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Parking the order failed");

      const orderId = data?.order?.id || data?.orderId;
      if (!orderId) throw new Error("No order id returned");
      onComplete(orderId, true); // parked
      onOpenChange(false);
    } catch (e: any) {
      setError(e?.message || "Parking the order failed");
    } finally {
      setBusy(false);
    }
  };

  const submitCheckout = async () => {
    if (!cartId || !clientId || !registerId) {
      setError("Missing cart, customer or outlet.");
      return;
    }
    if (remaining > 0) return; // must be fully paid to complete

    try {
      setBusy(true);
      const idem =
        ((globalThis.crypto as any)?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`) as string;

      const payload: {
        cartId: string;
        payments: Payment[];
        storeId: string | null;
        registerId: string | null;
        discount?: DiscountPayload;
        niftipay?: { chain: string; asset: string; amount: number } | undefined;
      } = {
        cartId,
        payments,
        storeId,
        registerId,
      };

      if (discount && Number.isFinite(discount.value) && discount.value > 0) {
        payload.discount = discount;
      }

      const res = await fetch("/api/pos/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": idem },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Checkout failed");

      const orderId = data?.order?.id || data?.orderId;
      if (!orderId) throw new Error("No order id returned");
      onComplete(orderId);
      onOpenChange(false);
    } catch (e: any) {
      setError(e?.message || "Checkout failed");
    } finally {
      setBusy(false);
    }
  };


  const canPark = !!cartId && !!clientId && !!registerId && !busy; // no “must be fully covered”
  const canComplete = remaining === 0 && !busy && !niftiSelectionRequired;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Checkout</DialogTitle>
          </DialogHeader>

          <div className="space-y-6">
            {/* Totals */}
            <div className="space-y-2">
              <div className="flex justify-between text-lg">
                <span className="font-medium">Estimated Total</span>
                <span className="font-bold text-primary">${totalEstimate.toFixed(2)}</span>
              </div>
              {payments.length > 0 && (
                <>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Paid</span>
                    <span className="text-accent">${totalPaid.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between text-lg">
                    <span className="font-medium">Remaining</span>
                    <span className="font-bold">${remaining.toFixed(2)}</span>
                  </div>
                </>
              )}
            </div>

            {/* Payment methods */}
            <div className="space-y-2">
              <Label>Payment Method</Label>
              <div className="grid grid-cols-2 gap-3">
                {paymentMethods.map((m) => (
                  <Card
                    key={m.id}
                    className={cn(
                      "p-4 cursor-pointer transition-all hover:border-primary",
                      currentMethodId === m.id && "border-primary bg-primary/5",
                    )}
                    onClick={() => setCurrentMethodId(m.id)}
                  >
                    <div className="flex flex-col items-center gap-1">
                      <span className="font-medium">{m.name}</span>
                      {m.description && (
                        <span className="text-xs text-muted-foreground">{m.description}</span>
                      )}
                    </div>
                  </Card>
                ))}
              </div>
            </div>

            {/* Niftipay network picker (shown only when current method is Niftipay) */}
            {currentMethodIsNiftipay && (
              <div className="space-y-2">
                <Label>Crypto Network</Label>
                <div>
                  <select
                    className="w-full border rounded-md px-3 h-10 bg-background"
                    value={selectedNiftipay}
                    onChange={(e) => setSelectedNiftipay(e.target.value)}
                    disabled={niftipayLoading || niftipayNetworks.length === 0}
                  >
                    {!selectedNiftipay && <option value="">{niftipayLoading ? "Loading…" : "Select network"}</option>}
                    {niftipayNetworks.map((n) => (
                      <option key={`${n.chain}:${n.asset}`} value={`${n.chain}:${n.asset}`}>
                        {n.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            )}

            {/* Amount + helpers */}
            {remaining > 0 && (
              <>
                <div className="space-y-2">
                  <Label>Amount</Label>
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    max={remaining}
                    value={currentAmount}
                    onChange={(e) => setCurrentAmount(e.target.value)}
                    placeholder="0.00"
                  />
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => handleQuickAmount(0.25)}>
                      25%
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => handleQuickAmount(0.5)}>
                      50%
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => handleQuickAmount(0.75)}>
                      75%
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => handleQuickAmount(1)}>
                      Full
                    </Button>
                  </div>
                </div>

                {currentIsCash && (
                  <div className="space-y-2">
                    <Label>Cash Received</Label>
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      value={cashReceived}
                      onChange={(e) => setCashReceived(e.target.value)}
                      placeholder={currentAmount || "0.00"}
                    />
                    {change > 0 && (
                      <p className="text-sm">
                        Change:{" "}
                        <span className="font-bold text-accent">${toMoney(change).toFixed(2)}</span>
                      </p>
                    )}
                  </div>
                )}

                <Button
                  className="w-full"
                  onClick={handleAddPayment}
                  disabled={
                    !currentAmount ||
                    !currentMethodId ||
                    Number.parseFloat(currentAmount) <= 0 ||
                    Number.parseFloat(currentAmount) > remaining ||
                    (currentMethodIsNiftipay && niftipayNetworks.length > 0 && !selectedNiftipay)
                  }
                >
                  Add Payment
                </Button>
              </>
            )}

            {/* Split list */}
            {payments.length > 0 && (
              <div className="space-y-2">
                {payments.map((p) => {
                  const methodName =
                    paymentMethods.find((pm) => pm.id === p.methodId)?.name ?? p.methodId;
                return (
                  <Card key={p.methodId} className="p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="font-medium">{methodName}</div>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="font-medium tabular-nums">${p.amount.toFixed(2)}</span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => removePayment(p.methodId)}
                          aria-label={`Remove ${methodName}`}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </Card>
                )})}
              </div>
            )}

            {/* Actions */}
            <div className="flex flex-col sm:flex-row gap-2">
              {payments.length > 0 && (
                <Button
                  variant="outline"
                  onClick={() => {
                    setPayments([]);
                    setCurrentAmount("");
                    setCashReceived("");
                  }}
                  disabled={busy}
                  className="w-full sm:w-auto"
                >
                  Reset
                </Button>
              )}

              {/* Park order (partial allowed) */}
              <TooltipProvider>
                <Tooltip delayDuration={200}>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      aria-label="Park order (save with remaining balance)"
                      variant="outline"
                      className={cn(
                        "w-full sm:flex-1 border-amber-500 text-amber-700 hover:bg-amber-50",
                        "dark:border-amber-400 dark:text-amber-300 dark:hover:bg-amber-950",
                      )}
                      onClick={submitParkedCheckout}
                      disabled={!canPark || niftiSelectionRequired}
                     >
                      <PauseCircle className="h-4 w-4" />
                      Park Order
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="top" align="start" className="max-w-xs">
                    Save this sale as <b>Pending Payment</b>. Partial payments are recorded and the
                    remaining balance stays due.
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>

              {/* Complete */}
              <Button className="w-full sm:flex-1" onClick={submitCheckout} disabled={!canComplete}>
                <Check className="h-4 w-4" />
                Complete Transaction
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Error dialog */}
      <AlertDialog open={!!error} onOpenChange={(o) => !o && setError(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Checkout error</AlertDialogTitle>
          </AlertDialogHeader>
          <div className="text-sm text-muted-foreground">{error}</div>
          <AlertDialogFooter>
            <AlertDialogAction onClick={() => setError(null)}>OK</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
