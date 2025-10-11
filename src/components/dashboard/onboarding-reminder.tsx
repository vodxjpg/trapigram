"use client";

import * as React from "react";
import { Check, ChevronRight, CircleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export const ONBOARDING_REFRESH_EVENT = "onboarding:refresh";

// Now includes the term step key
export type RequiredStepKey =
    | "payment-method"
    | "shipping-company"
    | "shipping-method"
    | "product-category"
    | "product-attribute"
    | "attribute-term";

type Status = {
    hasPayment: boolean;
    hasCompany: boolean;
    hasMethod: boolean;
    hasCategory: boolean;
    hasAttribute: boolean;
    hasTerm: boolean; // NEW
};

export function useOnboardingStatus() {
    const [loading, setLoading] = React.useState(true);
    const [status, setStatus] = React.useState<Status>({
        hasPayment: false,
        hasCompany: false,
        hasMethod: false,
        hasCategory: false,
        hasAttribute: false,
        hasTerm: false,
    });

    const refresh = React.useCallback(async () => {
        setLoading(true);
        try {
            // Payments – only active=true
            const payRes = await fetch("/api/payment-methods?active=true", { method: "GET" });
            if (!payRes.ok) throw new Error("Failed to load payments");
            const pay = await payRes.json();

            const compRes = await fetch("/api/shipping-companies", { method: "GET" });
            if (!compRes.ok) throw new Error("Failed to load companies");
            const comp = await compRes.json();

            const shipRes = await fetch("/api/shipments", { method: "GET" });
            if (!shipRes.ok) throw new Error("Failed to load shipments");
            const ship = await shipRes.json();

            const catRes = await fetch("/api/product-categories?pageSize=1", {
                method: "GET",
                credentials: "include",
            });
            if (!catRes.ok) throw new Error("Failed to load categories");
            const cat = await catRes.json();

            const attrRes = await fetch("/api/product-attributes?pageSize=100", {
                method: "GET",
                credentials: "include",
            });
            if (!attrRes.ok) throw new Error("Failed to load attributes");
            const attr = await attrRes.json();

            const hasAttribute =
                Array.isArray(attr?.attributes) ? attr.attributes.length > 0 : !!attr?.attributes?.length;

            // Determine if ANY term exists across attributes
            let hasTerm = false;
            if (hasAttribute) {
                const attrs: Array<{ id: string }> = attr.attributes;
                // Check terms for each attribute until we find one (cap to avoid excessive calls)
                const cap = Math.min(attrs.length, 25);
                for (let i = 0; i < cap; i++) {
                    const a = attrs[i];
                    try {
                        const tRes = await fetch(`/api/product-attributes/${a.id}/terms?pageSize=1`, {
                            method: "GET",
                            credentials: "include",
                        });
                        if (!tRes.ok) continue;
                        const t = await tRes.json();
                        if (Array.isArray(t?.terms) ? t.terms.length > 0 : !!t?.terms?.length) {
                            hasTerm = true;
                            break;
                        }
                    } catch {
                        // ignore individual term fetch errors
                    }
                }
            }

            setStatus({
                hasPayment: Array.isArray(pay?.methods) ? pay.methods.length > 0 : !!pay?.methods?.length,
                hasCompany: Array.isArray(comp?.companies) ? comp.companies.length > 0 : !!comp?.companies?.length,
                hasMethod: Array.isArray(ship?.shipments) ? ship.shipments.length > 0 : !!ship?.shipments?.length,
                hasCategory: Array.isArray(cat?.categories) ? cat.categories.length > 0 : !!cat?.categories?.length,
                hasAttribute,
                hasTerm, // set from loop above
            });
        } catch (e: any) {
            console.error(e);
            toast.error(e?.message || "Failed to load setup status");
        } finally {
            setLoading(false);
        }
    }, []);

    React.useEffect(() => {
        refresh();
    }, [refresh]);

    const completedCount =
        Number(status.hasPayment) +
        Number(status.hasCompany) +
        Number(status.hasMethod) +
        Number(status.hasCategory) +
        Number(status.hasAttribute) +
        Number(status.hasTerm);

    const totalRequired = 6; // now counting the term step
    const remaining = totalRequired - completedCount;

    return { loading, status, completedCount, remaining, refresh, totalRequired };
}

type ReminderProps = {
    onOpenStep: (key: RequiredStepKey) => void;
    className?: string;
};

export function OnboardingReminder({ onOpenStep, className }: ReminderProps) {
    const { loading, status, remaining, refresh, totalRequired } = useOnboardingStatus();
    const [open, setOpen] = React.useState(false);

    React.useEffect(() => {
        const handler = () => refresh();
        window.addEventListener(ONBOARDING_REFRESH_EVENT, handler);
        return () => window.removeEventListener(ONBOARDING_REFRESH_EVENT, handler);
    }, [refresh]);

    if (loading) return null;
    if (remaining <= 0) return null;

    const items: { key: RequiredStepKey; title: string; done: boolean }[] = [
        { key: "payment-method", title: "Create a payment method", done: status.hasPayment },
        { key: "shipping-company", title: "Create a shipping company", done: status.hasCompany },
        { key: "shipping-method", title: "Create a shipping method", done: status.hasMethod },
        { key: "product-category", title: "Create a product category", done: status.hasCategory },
        { key: "product-attribute", title: "Create a product attribute", done: status.hasAttribute },
        // NEW checklist item
        { key: "attribute-term", title: "Create a term for an attribute", done: status.hasTerm },
    ];

    return (
        <>
            <div className={cn("px-4 lg:px-6", className)}>
                <div className="flex items-center justify-between rounded-lg border bg-card p-3">
                    <div className="flex items-center gap-2">
                        <CircleAlert className="h-4 w-4 text-primary" />
                        <p className="text-sm">
                            Finish setup — <span className="font-medium">{remaining}</span>{" "}
                            {remaining === 1 ? "step" : "steps"} left
                        </p>
                    </div>
                    <Button size="sm" onClick={() => setOpen(true)}>Open checklist</Button>
                </div>
            </div>

            <Dialog open={open} onOpenChange={setOpen}>
                <DialogContent className="sm:max-w-lg">
                    <DialogHeader>
                        <DialogTitle>You're off to a great start</DialogTitle>
                        <DialogDescription>
                            {totalRequired - remaining}/{totalRequired} completed
                        </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-2">
                        <Separator />
                        {items.map((it) => (
                            <button
                                key={it.key}
                                type="button"
                                onClick={() => {
                                    setOpen(false);
                                    onOpenStep(it.key);
                                }}
                                className={cn(
                                    "w-full rounded-md border p-3 text-left transition hover:bg-muted/50",
                                    it.done ? "opacity-70" : ""
                                )}
                            >
                                <div className="flex items-center justify-between">
                                    <div className="space-y-1">
                                        <div className="text-sm font-medium">{it.title}</div>
                                        {it.done ? (
                                            <div className="text-xs text-muted-foreground">Completed</div>
                                        ) : (
                                            <div className="text-xs text-muted-foreground">Tap to complete this step</div>
                                        )}
                                    </div>
                                    {it.done ? (
                                        <Check className="h-5 w-5 text-green-600" />
                                    ) : (
                                        <ChevronRight className="h-5 w-5 text-muted-foreground" />
                                    )}
                                </div>
                            </button>
                        ))}
                    </div>
                </DialogContent>
            </Dialog>
        </>
    );
}
