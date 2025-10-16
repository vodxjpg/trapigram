import { Product, OrderItem } from "./types";
import { toast } from "sonner";

export const tokenOf = (p: Product) => `${p.id}:${p.variationId ?? "base"}`;
export const parseToken = (t: string) => {
    const [productId, v] = String(t).split(":");
    return { productId, variationId: v === "base" ? null : v };
};

export const inCartQty = (pid: string, vid: string | null, items: OrderItem[] = []) =>
    items.reduce((sum, it) =>
        sum + (it.product.id === pid && (it.product.variationId ?? null) === (vid ?? null) ? it.quantity : 0), 0);

export const stockForCountry = (p: Product, country: string) =>
    Object.values(p.stockData || {}).reduce((sum, wh) => sum + (wh?.[country] ?? 0), 0);

const EU = new Set(["AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IE", "IT",
    "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE"]);
export const countryToFiat = (c: string) => (c?.toUpperCase() === "GB" ? "GBP" : EU.has(c?.toUpperCase()) ? "EUR" : "USD");

export const fmtCrypto = (n: number | string) =>
    Number(n).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 8 });

export function showFriendlyCreateOrderError(raw?: string | null) {
    const msg = (raw || "").toLowerCase();
    if (msg.includes("no shipping methods available")) return toast.error("You need to create a shipping method first"), true;
    if (msg.includes("no shipping companies") || msg.includes("shipping company required") || msg.includes("missing shipping company"))
        return toast.error("You need to set up a shipping company first"), true;
    if (msg.includes("niftipay not configured for tenant"))
        return toast.error("You need to configure Niftipay or another payment method"), true;
    if (msg.includes("no payment methods") || msg.includes("payment method required") ||
        msg.includes("missing payment method") || msg.includes("payment methods not configured"))
        return toast.error("You need to set up a payment method first"), true;
    return false;
}
