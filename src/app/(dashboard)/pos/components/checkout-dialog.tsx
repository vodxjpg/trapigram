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
import { PauseCircle, Check, X, RefreshCw } from "lucide-react";
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

// Adjust if your app uses a different route
const PAYMENT_METHODS_URL = "/payment-methods";

function toMoney(n: number) {
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

  // ───────────────────────── State ─────────────────────────
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethodRow[]>([]);
  const [methodsLoaded, setMethodsLoaded] = useState(false);
  const [methodsReload, setMethodsReload] = useState(0);
  const [currentMethodId, setCurrentMethodId] = useState<string | null>(null);

  const [payments, setPayments] = useState<Payment[]>([]);
  const [currentAmount, setCurrentAmount] = useState("");
  const [cashReceived, setCashReceived] = useState("");

  const [busy, setBusy] = useState(false);
  const [busyAction, setBusyAction] = useState<"park" | "complete" | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Niftipay network state
  const [niftipayNetworks, setNiftipayNetworks] = useState<NiftipayNet[]>([]);
  const [niftipayLoading, setNiftipayLoading] = useState(false);
  const [selectedNiftipay, setSelectedNiftipay] = useState(""); // "chain:asset"

  // ───────────────────────── Derived ─────────────────────────
  const totalPaid = useMemo(() => payments.reduce((s, p) => s + p.amount, 0), [payments]);
  const remaining = Math.max(0, toMoney(totalEstimate - totalPaid));

  const currentIsCash = useMemo(() => {
    const m = paymentMethods.find((pm) => pm.id === currentMethodId);
    return (m?.name || "").toLowerCase().includes("cash");
  }, [paymentMethods, currentMethodId]);

  const change =
    currentIsCash && cashReceived
      ? Math.max(
          0,
          Number.parseFloat(cashReceived) - (Number.parseFloat(currentAmount || "0") || 0)
        )
      : 0;

  const hasNiftipayMethod = useMemo(
    () => paymentMethods.some((m) => /niftipay/i.test(m.name || "")),
    [paymentMethods]
  );

  const currentMethodIsNiftipay = useMemo(() => {
    const m = paymentMethods.find((pm) => pm.id === currentMethodId);
    return !!m && /niftipay/i.test(m.name || "");
  }, [paymentMethods, currentMethodId]);

  // If any existing split is Niftipay, require a selected network to proceed
  const niftiInPayments = useMemo(() => {
    return payments.some((p) => {
      const name = paymentMethods.find((pm) => pm.id === p.methodId)?.name || "";
      return /niftipay/i.test(name);
    });
  }, [payments, paymentMethods]);

  const niftiSelectionRequired =
    niftiInPayments && niftipayNetworks.length > 0 && !selectedNiftipay;

  // Block adding a Niftipay split until the networks are loaded AND one is selected
  const niftiBlocked =
    currentMethodIsNiftipay &&
    (niftipayLoading || niftipayNetworks.length === 0 || !selectedNiftipay);

  // Consider API layer "loading" done only when:
  //  • payment methods are loaded, and
  //  • if Niftipay is present among methods, its networks call has finished
  const apisLoading = !methodsLoaded || (hasNiftipayMethod && niftipayLoading);

  const noPosMethods = methodsLoaded && paymentMethods.length === 0;

  const canPark =
    !!cartId && !!clientId && !!registerId && !busy && !apisLoading /* block while loading */;

  const canComplete =
    remaining === 0 && !busy && !apisLoading && !niftiSelectionRequired;

  // ───────────────────────── Effects ─────────────────────────
  // Reset lightweight state on close
  useEffect(() => {
    if (!open) {
      setPayments([]);
      setCurrentAmount("");
      setCashReceived("");
      setBusy(false);
      setBusyAction(null);
      setError(null);
      setSelectedNiftipay("");
    }
  }, [open]);

  // Fetch Niftipay networks
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

  // Load active payment methods when dialog opens (no local fallback)
  useEffect(() => {
    if (!open || !cartId) return;
    let ignore = false;

    (async () => {
      setMethodsLoaded(false);
      try {
        const res = await fetch(`/api/pos/checkout?cartId=${encodeURIComponent(cartId)}`);
        const j = await res.json().catch(() => ({} as any));
        if (!res.ok) throw new Error(j?.error || "Failed to load payment methods");

        const raw: any[] = j?.paymentMethods ?? j?.methods ?? j?.data ?? [];
        const methods: PaymentMethodRow[] = raw
          .map((m) => ({
            id: String(m.id ?? m.methodId ?? m.key ?? ""),
            name: String(m.name ?? m.title ?? "Method"),
            description: m.description ?? null,
            instructions: m.instructions ?? null,
          }))
          .filter((m) => m.id);

        if (!ignore) {
          setPaymentMethods(methods);
          setCurrentMethodId(methods[0]?.id ?? null);
        }
      } catch (e: any) {
        if (!ignore) {
          setPaymentMethods([]);
          setError(e?.message || "Failed to load payment methods");
        }
      } finally {
        if (!ignore) setMethodsLoaded(true);
      }
    })();

    return () => {
      ignore = true;
    };
  }, [open, cartId, methodsReload]);

  // When Niftipay is among methods, fetch its networks
  useEffect(() => {
    if (!open) return;
    if (!hasNiftipayMethod) {
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
  }, [open, hasNiftipayMethod, selectedNiftipay]);

  // ───────────────────────── Helpers ─────────────────────────
  const openPaymentMethodsTab = () =>
    window.open(PAYMENT_METHODS_URL, "_blank", "noopener,noreferrer");
  const refreshMethods = () => setMethodsReload((n) => n + 1);

  const handleAddPayment = () => {
    const amount = Number.parseFloat(currentAmount);
    if (!currentMethodId) return;
    if (!Number.isFinite(amount) || amount <= 0) return;
    if (amount > remaining) return;
    if (niftiBlocked) return; // hard block for Niftipay until ready/selected

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

  // ───────────────────────── Submit actions ─────────────────────────
  const submitParkedCheckout = async () => {
    if (!cartId || !clientId || !registerId) {
      setError("Missing cart, customer or outlet.");
      return;
    }
    try {
      setBusy(true);
      setBusyAction("park");
      const idem =
        ((globalThis.crypto as any)?.randomUUID?.() ??
          `${Date.now()}-${Math.random()}`) as string;

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
        payments,
        storeId,
        registerId,
        parked: true,
      };

      if (discount && Number.isFinite(discount.value) && discount.value > 0) {
        payload.discount = discount;
      }

      const niftiAmount = payments
        .filter(
          (p) =>
            /niftipay/i.test(
              paymentMethods.find((pm) => pm.id === p.methodId)?.name || ""
            )
        )
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
      onComplete(orderId, true);
      onOpenChange(false);
    } catch (e: any) {
      setError(e?.message || "Parking the order failed");
    } finally {
      setBusy(false);
      setBusyAction(null);
    }
  };

  const submitCheckout = async () => {
    if (!cartId || !clientId || !registerId) {
      setError("Missing cart, customer or outlet.");
      return;
    }
    if (remaining > 0) return;

    try {
      setBusy(true);
      setBusyAction("complete");
      const idem =
        ((globalThis.crypto as any)?.randomUUID?.() ??
          `${Date.now()}-${Math.random()}`) as string;

      const payload: {
        cartId: string;
        payments: Payment[];
        storeId: string | null;
        registerId: string | null;
        discount?: DiscountPayload;
      } = {
        cartId,
        payments,
        storeId,
        registerId,
      };

      if (discount && Number.isFinite(discount.value) && discount.value > 0) {
        payload.discount = discount;
      }

      const niftiAmount = payments
        .filter(
          (p) =>
            /niftipay/i.test(
              paymentMethods.find((pm) => pm.id === p.methodId)?.name || ""
            )
        )
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
      if (!res.ok) throw new Error(data?.error || "Checkout failed");

      const orderId = data?.order?.id || data?.orderId;
      if (!orderId) throw new Error("No order id returned");
      onComplete(orderId);
      onOpenChange(false);
    } catch (e: any) {
      setError(e?.message || "Checkout failed");
    } finally {
      setBusy(false);
      setBusyAction(null);
    }
  };

  // ───────────────────────── Render ─────────────────────────
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

            {/* Payment methods (or empty state) */}
            <div className="space-y-2">
              <Label>Payment Method</Label>

              {noPosMethods ? (
                <div className="rounded-md border p-4 bg-muted/30">
                  <p className="text-sm">
                    You don’t have any <strong>POS payment methods</strong> enabled. Create one to
                    accept payments here.
                  </p>
                  <div className="mt-3 flex items-center gap-2">
                    <Button onClick={openPaymentMethodsTab}>
                      Open Payment Methods (new tab)
                    </Button>
                    <Button variant="outline" onClick={refreshMethods}>
                      <RefreshCw className="h-4 w-4 mr-2" />
                      Refresh
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  {paymentMethods.map((m) => (
                    <Card
                      key={m.id}
                      className={cn(
                        "p-4 cursor-pointer transition-all hover:border-primary",
                        currentMethodId === m.id && "border-primary bg-primary/5"
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
              )}
            </div>

            {/* Niftipay network picker */}
            {!noPosMethods && currentMethodIsNiftipay && (
              <div className="space-y-2">
                <Label>Crypto Network</Label>
                <div>
                  <select
                    className="w-full border rounded-md px-3 h-10 bg-background"
                    value={selectedNiftipay}
                    onChange={(e) => setSelectedNiftipay(e.target.value)}
                    disabled={niftipayLoading || niftipayNetworks.length === 0}
                  >
                    {!selectedNiftipay && (
                      <option value="">
                        {niftipayLoading ? "Loading…" : "Select network"}
                      </option>
                    )}
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
            {!noPosMethods && remaining > 0 && (
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
                        <span className="font-bold text-accent">
                          ${toMoney(change).toFixed(2)}
                        </span>
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
                    niftiBlocked // unified Niftipay gate
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
                          <span className="font-medium tabular-nums">
                            ${p.amount.toFixed(2)}
                          </span>
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
                  );
                })}
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
                  disabled={busy || apisLoading}
                  className="w-full sm:w-auto"
                >
                  Reset
                </Button>
              )}

              {/* Park order */}
              <TooltipProvider>
                <Tooltip delayDuration={200}>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      aria-busy={apisLoading || (busy && busyAction === "park")}
                      aria-label="Park order (save with remaining balance)"
                      variant="outline"
                      className={cn(
                        "w-full sm:flex-1 border-amber-500 text-amber-700 hover:bg-amber-50",
                        "dark:border-amber-400 dark:text-amber-300 dark:hover:bg-amber-950"
                      )}
                      onClick={submitParkedCheckout}
                      disabled={!canPark || niftiSelectionRequired}
                    >
                      {apisLoading ? (
                        "Loading…"
                      ) : busy && busyAction === "park" ? (
                        "Parking…"
                      ) : (
                        <>
                          <PauseCircle className="h-4 w-4" />
                          <span className="ml-2">Park Order</span>
                        </>
                      )}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="top" align="start" className="max-w-xs">
                    Save this sale as <b>Pending Payment</b>. Partial payments are recorded and the
                    remaining balance stays due.
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>

              {/* Complete */}
              <Button
                className="w-full sm:flex-1"
                onClick={submitCheckout}
                aria-busy={apisLoading || (busy && busyAction === "complete")}
                disabled={!canComplete}
              >
                {apisLoading ? (
                  "Loading…"
                ) : busy && busyAction === "complete" ? (
                  "Completing…"
                ) : (
                  <>
                    <Check className="h-4 w-4" />
                    <span className="ml-2">Complete Transaction</span>
                  </>
                )}
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
