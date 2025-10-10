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

// These are the 5 REQUIRED items for completion (terms are optional, welcome stays last)
export type RequiredStepKey =
    | "payment-method"
    | "shipping-company"
    | "shipping-method"
    | "product-category"
    | "product-attribute";

type Status = {
    hasPayment: boolean;
    hasCompany: boolean;
    hasMethod: boolean;
    hasCategory: boolean;
    hasAttribute: boolean;
};

export const ONBOARDING_REFRESH_EVENT = "onboarding:refresh";

export function useOnboardingStatus() {
    const [loading, setLoading] = React.useState(true);
    const [status, setStatus] = React.useState<Status>({
        hasPayment: false,
        hasCompany: false,
        hasMethod: false,
        hasCategory: false,
        hasAttribute: false,
    });

    const refresh = React.useCallback(async () => {
        setLoading(true);
        try {
            // Payments – only active=true
            const payRes = await fetch("/api/payment-methods?active=true", {
                method: "GET",
            });
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

            const attrRes = await fetch("/api/product-attributes?pageSize=1", {
                method: "GET",
                credentials: "include",
            });
            if (!attrRes.ok) throw new Error("Failed to load attributes");
            const attr = await attrRes.json();

            setStatus({
                hasPayment: Array.isArray(pay?.methods) ? pay.methods.length > 0 : !!pay?.methods?.length,
                hasCompany: Array.isArray(comp?.companies) ? comp.companies.length > 0 : !!comp?.companies?.length,
                hasMethod: Array.isArray(ship?.shipments) ? ship.shipments.length > 0 : !!ship?.shipments?.length,
                hasCategory: Array.isArray(cat?.categories) ? cat.categories.length > 0 : !!cat?.categories?.length,
                hasAttribute: Array.isArray(attr?.attributes) ? attr.attributes.length > 0 : !!attr?.attributes?.length,
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
        Number(status.hasAttribute);

    const remaining = 5 - completedCount;

    return { loading, status, completedCount, remaining, refresh };
}

type ReminderProps = {
    onOpenStep: (key: RequiredStepKey) => void;
    className?: string;
};

export function OnboardingReminder({ onOpenStep, className }: ReminderProps) {
    // 🔽 change this line to also grab `refresh`
    const { loading, status, remaining, refresh } = useOnboardingStatus();

    const [open, setOpen] = React.useState(false);

    // 🔽 add this effect anywhere inside the component
    React.useEffect(() => {
        const handler = () => refresh();
        window.addEventListener(ONBOARDING_REFRESH_EVENT, handler);
        return () => window.removeEventListener(ONBOARDING_REFRESH_EVENT, handler);
    }, [refresh]);

    if (loading) return null;
    // Hide button when everything is done
    if (remaining <= 0) return null;

    const items: { key: RequiredStepKey; title: string; done: boolean }[] = [
        { key: "payment-method", title: "Create a payment method", done: status.hasPayment },
        { key: "shipping-company", title: "Create a shipping company", done: status.hasCompany },
        { key: "shipping-method", title: "Create a shipping method", done: status.hasMethod },
        { key: "product-category", title: "Create a product category", done: status.hasCategory },
        { key: "product-attribute", title: "Create a product attribute", done: status.hasAttribute },
    ];

    return (
        <>
            <div className={cn("px-4 lg:px-6", className)}>
                <div className="flex items-center justify-between rounded-lg border bg-card p-3">
                    <div className="flex items-center gap-2">
                        <CircleAlert className="h-4 w-4 text-primary" />
                        <p className="text-sm">
                            Finish setup — <span className="font-medium">{remaining}</span> {remaining === 1 ? "step" : "steps"} left
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
                            {5 - remaining}/5 completed
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
