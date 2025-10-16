"use client";
import { useEffect, useMemo, useState, useCallback } from "react";
import { toast } from "sonner";
import { authClient } from "@/lib/auth-client";
import { formatCurrency } from "@/lib/currency";
import { api } from "./api";
import {
    Address, CouponBreakdown, OrderItem, PaymentMethod, Product,
    ShippingCompany, ShippingMethod, NiftipayNet,
} from "./types";
import {
    tokenOf, parseToken, inCartQty, stockForCountry, countryToFiat, showFriendlyCreateOrderError,
} from "./utils";

const DEBOUNCE_MS = 400;

export function useOrderCreate() {
    const { data: activeOrg } = authClient.useActiveOrganization();

    // clients/search
    const [clients, setClients] = useState<any[]>([]);
    const [clientsLoading, setClientsLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState("");
    const [searching, setSearching] = useState(false);
    const [searchResults, setSearchResults] = useState<any[]>([]);
    const [selectedClient, setSelectedClient] = useState("");
    const [clientCountry, setClientCountry] = useState("");

    // categories + catalog
    const [categoryMap, setCategoryMap] = useState<Record<string, string>>({});
    const [products, setProducts] = useState<Product[]>([]);
    const [productsLoading, setProductsLoading] = useState(true);

    // cart
    const [orderGenerated, setOrderGenerated] = useState(false);
    const [cartId, setCartId] = useState("");
    const [orderItems, setOrderItems] = useState<OrderItem[]>([]);
    const [itemsSubtotal, setItemsSubtotal] = useState(0);
    const [stockErrors, setStockErrors] = useState<Record<string, number>>({});
    const [selectedProduct, setSelectedProduct] = useState("");
    const [quantityText, setQuantityText] = useState("1");

    // addresses
    const [addresses, setAddresses] = useState<Address[]>([]);
    const [selectedAddressId, setSelectedAddressId] = useState("");
    const [newAddress, setNewAddress] = useState("");

    // coupons
    const [couponCode, setCouponCode] = useState("");
    const [appliedCodes, setAppliedCodes] = useState<string[]>([]);
    const [discountTotal, setDiscountTotal] = useState(0);
    const [couponBreakdown, setCouponBreakdown] = useState<CouponBreakdown[]>([]);
    const [couponTypeByCode, setCouponTypeByCode] = useState<Record<string, string>>({});
    const [couponValues, setCouponValues] = useState<number[]>([]);

    // shipping + payment
    const [shippingMethods, setShippingMethods] = useState<ShippingMethod[]>([]);
    const [shippingCompanies, setShippingCompanies] = useState<ShippingCompany[]>([]);
    const [shippingLoading, setShippingLoading] = useState(false);
    const [selectedShippingMethod, setSelectedShippingMethod] = useState("");
    const [selectedShippingCompany, setSelectedShippingCompany] = useState("");
    const [shippingCost, setShippingCost] = useState(0);

    const [paymentLoading, setPaymentLoading] = useState(false);
    const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);
    const [selectedPaymentMethod, setSelectedPaymentMethod] = useState("");

    // niftipay
    const [niftipayNetworks, setNiftipayNetworks] = useState<NiftipayNet[]>([]);
    const [niftipayLoading, setNiftipayLoading] = useState(false);
    const [selectedNiftipay, setSelectedNiftipay] = useState("");

    const parseQty = (s: string) => {
        const n = parseInt(s, 10);
        return Number.isFinite(n) && n > 0 ? n : 1;
    };

    /* ---------- bootstraps ---------- */
    useEffect(() => {
        (async () => {
            try {
                setClientsLoading(true);
                const { clients: list } = await api.clients("", 1, 50);
                setClients(list ?? []);
            } catch { toast.error("Failed loading clients"); }
            finally { setClientsLoading(false); }
        })();
    }, []);

    useEffect(() => {
        (async () => {
            try {
                setProductsLoading(true);
                // categories map (id->name)
                const cat = await api.categoriesAll().catch(() => ({}));
                const rows: Array<{ id: string; name: string }> = cat?.categories ?? cat?.items ?? [];
                setCategoryMap(Object.fromEntries((rows ?? []).map((c) => [c.id, c.name])));

                // both catalogs
                const [{ productsFlat }, { products: aff }] = await Promise.all([
                    api.products("", 1, 1000),
                    api.affiliateProducts("", 1000),
                ]);

                const norm: Product[] = (productsFlat ?? []).map((p: any) => ({
                    id: p.id, variationId: p.variationId ?? null, title: p.title,
                    allowBackorders: !!p.allowBackorders, sku: p.sku, description: p.description,
                    image: p.image, regularPrice: p.regularPrice,
                    price: Object.values(p.salePrice ?? p.regularPrice)[0] ?? 0,
                    stockData: p.stockData, isAffiliate: false, subtotal: 0, categories: p.categories ?? [],
                }));
                const affList: Product[] = (aff ?? []).map((a: any) => ({
                    id: a.id, variationId: null, title: a.title, sku: a.sku, description: a.description, image: a.image,
                    regularPrice: { pts: (Object.values(a.pointsPrice ?? {})[0] as number) ?? 0 },
                    price: (Object.values(a.pointsPrice ?? {})[0] as number) ?? 0,
                    stockData: a.stock ?? {}, isAffiliate: true, subtotal: 0, categories: [],
                }));
                setProducts([...norm, ...affList]);
            } catch (e: any) { toast.error(e?.message || "Failed loading products"); }
            finally { setProductsLoading(false); }
        })();
    }, []);

    /* ---------- client search (debounced remote) ---------- */
    useEffect(() => {
        const q = searchTerm.trim();
        if (q.length < 3) { setSearchResults([]); setSearching(false); return; }
        const t = setTimeout(async () => {
            try {
                setSearching(true);
                const { clients: found } = await api.clients(q, 1, 10);
                setSearchResults(found ?? []);
            } catch { setSearchResults([]); }
            finally { setSearching(false); }
        }, DEBOUNCE_MS);
        return () => clearTimeout(t);
    }, [searchTerm]);

    const filteredClients = useMemo(() => {
        if (searchTerm.trim().length < 3) return clients;
        const t = searchTerm.toLowerCase();
        return clients.filter((c: any) =>
            c.username?.toLowerCase().includes(t) ||
            c.email?.toLowerCase().includes(t) ||
            `${c.firstName} ${c.lastName}`.toLowerCase().includes(t)
        );
    }, [clients, searchTerm]);

    const pickClient = useCallback((id: string, obj: any) => {
        setSelectedClient(id);
        if (!clients.some(c => c.id === id)) setClients(prev => [...prev, obj]);
        setSearchTerm(""); setSearchResults([]);
        setClientCountry(obj?.country || "");
    }, [clients]);

    /* ---------- cart/subtotal ---------- */
    useEffect(() => {
        const sum = orderItems.reduce((a, it) => a + (it.product.subtotal ?? it.product.price * it.quantity), 0);
        setItemsSubtotal(sum);
    }, [orderItems]);

    /* ---------- address/shipping/payment after client selection ---------- */
    useEffect(() => {
        if (!selectedClient) return;

        (async () => {
            try {
                const data = await api.clientAddresses(selectedClient);
                const addrs: Address[] = data.addresses ?? [];
                setAddresses(addrs);
                setSelectedAddressId(prev => prev && addrs.some(a => a.id === prev) ? prev : (addrs[0]?.id ?? ""));
            } catch { toast.error("Addresses load error"); setAddresses([]); }
        })();

        (async () => {
            try {
                setPaymentLoading(true);
                const data = await api.paymentMethods();
                setPaymentMethods(data.methods ?? []);
                if (!Array.isArray(data.methods) || data.methods.length === 0) toast.error("You need to set up a payment method first");
            } catch { toast.error("Payments load error"); }
            finally { setPaymentLoading(false); }
        })();

        (async () => {
            try {
                setShippingLoading(true);
                const ship = await api.shipments();
                const comp = await api.shippingCompanies();
                setShippingMethods(ship.shipments ?? []);
                const companies: ShippingCompany[] = comp?.companies ?? comp?.shippingMethods ?? [];
                setShippingCompanies(companies);
                if (!companies.length) toast.error("You need to set up a shipping company first");
                if (!(ship?.shipments ?? []).length) toast.error("You need to create a shipping method first");
            } catch { toast.error("Shipping load error"); }
            finally { setShippingLoading(false); }
        })();
    }, [selectedClient]);

    /* ---------- Niftipay networks when PM changes ---------- */
    useEffect(() => {
        const pm = paymentMethods.find(p => p.id === selectedPaymentMethod);
        if (!pm || !/niftipay/i.test(pm.name || "") || pm.active === false) {
            setNiftipayNetworks([]); setSelectedNiftipay(""); return;
        }
        (async () => {
            setNiftipayLoading(true);
            try {
                const { methods } = await api.niftipayMethods();
                const nets: NiftipayNet[] = (methods || []).map((m: any) => ({ chain: m.chain, asset: m.asset, label: m.label ?? `${m.asset} on ${m.chain}` }));
                setNiftipayNetworks(nets);
                if (!selectedNiftipay && nets[0]) setSelectedNiftipay(`${nets[0].chain}:${nets[0].asset}`);
            } catch (err: any) {
                if (!showFriendlyCreateOrderError(err?.message)) toast.error(err?.message || "Niftipay networks load error");
                setNiftipayNetworks([]);
            } finally { setNiftipayLoading(false); }
        })();
    }, [selectedPaymentMethod, paymentMethods, selectedNiftipay]);

    // smart default PM
    useEffect(() => {
        if (selectedPaymentMethod) return;
        const active = paymentMethods.filter(m => m.active !== false);
        const nonNifti = active.find(m => !/niftipay/i.test(m.name || ""));
        const pick = nonNifti ?? active[0] ?? paymentMethods[0];
        if (pick) setSelectedPaymentMethod(pick.id);
    }, [paymentMethods, selectedPaymentMethod]);

    /* ---------- shipping cost ---------- */
    const totalBeforeShipping = Math.max(0, itemsSubtotal - discountTotal);
    useEffect(() => {
        if (!selectedShippingMethod) return;
        const m = shippingMethods.find(m => m.id === selectedShippingMethod);
        const tier = m?.costs.find(c =>
            totalBeforeShipping >= c.minOrderCost && (c.maxOrderCost === 0 || totalBeforeShipping <= c.maxOrderCost)
        );
        setShippingCost(tier?.shipmentCost || 0);
    }, [totalBeforeShipping, selectedShippingMethod, shippingMethods]);

    /* ---------- actions ---------- */
    const generateOrder = useCallback(async () => {
        if (!selectedClient) return;
        const clientInfo = [...clients, ...searchResults].find(c => c.id === selectedClient);
        const country = clientInfo?.country || "";
        try {
            const { newCart } = await api.createCart({ clientId: selectedClient, country });
            setCartId(newCart.id);
            const { resultCartProducts } = await api.getCart(newCart.id);
            console.log(resultCartProducts)
            if (Array.isArray(resultCartProducts)) {
                setOrderItems(resultCartProducts.map((r: any) => ({
                    product: {
                        id: r.id, variationId: r.variationId ?? null, title: r.title, sku: r.sku,
                        description: r.description, image: r.image, price: r.unitPrice,
                        regularPrice: {}, stockData: {}, subtotal: r.subtotal,
                    },
                    quantity: r.quantity,
                })));
            }
            setClientCountry(country);
            setOrderGenerated(true);
            toast.success("Cart created!");
        } catch (e: any) { toast.error(e?.message || "Failed to create cart"); }
    }, [clients, searchResults, selectedClient]);

    const addProduct = useCallback(async () => {
        if (!selectedProduct || !cartId) return toast.error("Cart hasn’t been created yet!");
        const product = products.find(p => tokenOf(p) === selectedProduct);
        if (!product) return;

        const finite = Object.keys(product.stockData || {}).length > 0;
        const remaining = finite
            ? Math.max(0, stockForCountry(product, clientCountry) - inCartQty(product.id, product.variationId ?? null, orderItems))
            : Infinity;

        const qty = parseQty(quantityText);
        if (finite && !product.allowBackorders && (remaining === 0 || qty > remaining)) {
            toast.error(remaining === 0 ? "Out of stock" : `Only ${remaining} available`); return;
        }

        const unitPrice = product.regularPrice[clientCountry] ?? product.price;
        const { productId, variationId } = parseToken(selectedProduct);

        try {
            const res = await api.addToCart(cartId, { productId, variationId, quantity: qty, unitPrice, country: clientCountry });
            if (!res.ok) {
                const body = await res.json().catch(() => ({}));
                throw new Error(body.error || body.message || "Failed to add product");
            }
            const { product: added, quantity: qtyResp } = await res.json();
            const withStock: Product = { ...product, ...added, variationId: added.variationId ?? variationId ?? product.variationId ?? null };
            const subtotalRow = (withStock.price ?? unitPrice) * qtyResp;

            setOrderItems(prev => {
                const exists = prev.some(it => it.product.id === withStock.id && (it.product.variationId ?? null) === (withStock.variationId ?? null));
                const row = { product: { ...withStock, subtotal: subtotalRow }, quantity: qtyResp };
                return exists
                    ? prev.map(it =>
                        it.product.id === withStock.id && (it.product.variationId ?? null) === (withStock.variationId ?? null) ? row : it)
                    : [...prev, row];
            });

            setSelectedProduct(""); setQuantityText("1");
            toast.success("Product added to cart!");
        } catch (e: any) { toast.error(e?.message || "Could not add product"); }
    }, [cartId, clientCountry, orderItems, products, quantityText, selectedProduct]);

    const removeProduct = useCallback(async (productId: string, variationId: string | null, idx: number) => {
        if (!cartId) return toast.error("No cart created yet!");
        try {
            const res = await api.removeFromCart(cartId, { productId, variationId });
            if (!res.ok) {
                const err = await res.json().catch(() => null);
                throw new Error(err?.message || "Failed to remove product");
            }
            setOrderItems(prev => prev.filter((_, i) => i !== idx));
            toast.success("Product removed from cart");
        } catch (e: any) { toast.error(e?.message || "Could not remove product"); }
    }, [cartId]);

    const updateQuantity = useCallback(async (productId: string, variationId: string | null, action: "add" | "subtract") => {
        if (!cartId) return toast.error("Cart hasn’t been created yet!");
        try {
            const res = await api.updateCartLine(cartId, { productId, ...(variationId ? { variationId } : {}), action });
            if (!res.ok) {
                const err = await res.json().catch(() => null);
                throw new Error(err?.message || "Failed to update quantity");
            }
            const { lines } = await res.json();
            setOrderItems(prev => lines.map((l: any) => {
                const prevRow = prev.find(it => it.product.id === l.id && (it.product.variationId ?? null) === (l.variationId ?? null)) ?? prev.find(it => it.product.id === l.id);
                return {
                    product: {
                        id: l.id, variationId: l.variationId ?? prevRow?.product.variationId ?? null,
                        title: prevRow?.product.title ?? l.title, sku: prevRow?.product.sku ?? l.sku,
                        description: prevRow?.product.description ?? l.description, image: prevRow?.product.image ?? l.image,
                        price: l.unitPrice, regularPrice: { [clientCountry]: l.unitPrice }, stockData: prevRow?.product.stockData ?? {},
                        allowBackorders: prevRow?.product.allowBackorders, subtotal: l.subtotal,
                    },
                    quantity: l.quantity,
                };
            }));
        } catch (e: any) { toast.error(e?.message || "Could not update quantity"); }
    }, [cartId, clientCountry]);

    const applyCoupon = useCallback(async () => {
        if (!couponCode || !cartId) return toast.error("Generate cart first and enter a coupon");
        try {
            const res = await api.applyCoupon(cartId, { code: couponCode.trim(), total: itemsSubtotal });
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err?.error || err?.message || "Could not apply coupon");
            }
            const data = await res.json();
            if (data.discountValue !== undefined && data.discountValue !== null) {
                setCouponValues(prev => [...prev, Number(data.discountValue)]);
            }
            const codes = String(data.appliedCodes || "").split(",").map((s: string) => s.trim()).filter(Boolean);
            setAppliedCodes(codes);
            setDiscountTotal(Number(data.cumulativeDiscount || 0));
            setCouponBreakdown(Array.isArray(data.breakdown) ? data.breakdown : []);
            setCouponTypeByCode(prev => {
                const next = { ...prev };
                const type = String(data.discountType ?? "").trim();
                const justApplied = couponCode.trim();
                if (type && justApplied) next[justApplied] = type;
                for (const k of Object.keys(next)) if (!codes.includes(k)) delete next[k];
                return next;
            });
            setCouponCode("");
            toast.success("Coupon applied!");
        } catch (e: any) { toast.error(e?.message || "Could not apply coupon"); }
    }, [cartId, couponCode, itemsSubtotal]);

    const addAddress = useCallback(async () => {
        if (!newAddress || !selectedClient) return toast.error("Address field is required");
        try {
            const res = await fetch(`/api/clients/${selectedClient}/address`, {
                method: "POST", headers: {
                    "Content-Type": "application/json",
                    "x-internal-secret": process.env.NEXT_PUBLIC_INTERNAL_API_SECRET ?? ""
                },
                body: JSON.stringify({ clientId: selectedClient, address: newAddress }),
            });
            if (!res.ok) throw new Error("Failed to save address");
            const created: Address = await res.json();
            const data = await api.clientAddresses(selectedClient);
            const list: Address[] = data.addresses ?? [];
            setAddresses(list); setSelectedAddressId(created.id); setNewAddress("");
            toast.success("Address added");
        } catch (e: any) { toast.error(e?.message || "Failed to save address"); }
    }, [newAddress, selectedClient]);

    const cancelOrder = useCallback(() => {
        setSelectedClient(""); setOrderGenerated(false); setOrderItems([]); setCouponCode("");
        setAppliedCodes([]); setDiscountTotal(0); setCouponBreakdown([]); setSelectedPaymentMethod("");
        setClientCountry(""); setSelectedShippingMethod(""); setSelectedShippingCompany(""); setShippingCost(0);
        setCouponTypeByCode({}); setCouponValues([]); setCartId("");
    }, []);

    const totalBefore = Math.max(0, itemsSubtotal - discountTotal);
    const total = totalBefore + shippingCost;

    const createOrder = useCallback(async () => {
        if (!orderGenerated) return toast.error("Generate your cart first!");
        if (!Array.isArray(paymentMethods) || paymentMethods.length === 0) return toast.error("You need to set up a payment method first");
        if (!Array.isArray(shippingMethods) || shippingMethods.length === 0) return toast.error("You need to create a shipping method first");
        if (!Array.isArray(shippingCompanies) || shippingCompanies.length === 0) return toast.error("You need to set up a shipping company first");

        const pmObj = paymentMethods.find(m => m.id === selectedPaymentMethod);
        const payment = pmObj?.name;
        if (!payment) return toast.error("Select a payment method");

        const isNiftipay = /niftipay/i.test(payment);
        const niftipayConfigured = niftipayNetworks.length > 0;
        if (isNiftipay && niftipayConfigured && !selectedNiftipay) return toast.error("Select the crypto network/asset");

        const shippingMethodObj = shippingMethods.find(m => m.id === selectedShippingMethod);
        if (!shippingMethodObj) return toast.error("Select a shipping method");

        const shippingCompanyName = shippingCompanies.find(c => c.id === selectedShippingCompany)?.name;
        if (!shippingCompanyName) return toast.error("Select a shipping company");

        const addr = addresses.find(a => a.id === selectedAddressId);
        if (!addr) return toast.error("Select an address");

        const payload = {
            clientId: selectedClient, cartId, country: clientCountry, paymentMethod: payment,
            shippingAmount: shippingCost,
            shippingMethodTitle: shippingMethodObj.title,
            shippingMethodDescription: shippingMethodObj.description,
            address: addr.address,
            subtotal: itemsSubtotal,
            discountAmount: discountTotal,
            couponCode: appliedCodes.length ? appliedCodes.join(",") : null,
            couponType: appliedCodes.length ? appliedCodes.map(c => couponTypeByCode[c] || "").filter(Boolean).join(",") : null,
            discountValue: couponValues.length ? couponValues : [],
            shippingCompany: shippingCompanyName,
        };

        try {
            const res = await api.createOrder(payload);
            const data = await res.json();
            if (!res.ok) {
                if (Array.isArray(data.products)) {
                    const errs: Record<string, number> = {};
                    data.products.forEach((p: any) => { errs[p.productId] = p.available; });
                    setStockErrors(errs);
                }
                const raw = data?.error || data?.message;
                if (!showFriendlyCreateOrderError(raw)) toast.error(raw || "Failed to create order");
                return;
            }

            toast.success("Order created successfully!");

            // Niftipay invoice (optional)
            if (isNiftipay && niftipayConfigured) {
                const [chain, asset] = selectedNiftipay.split(":");
                const client = [...clients, ...searchResults].find(c => c.id === selectedClient)!;
                const safeEmail = client.email?.trim() || "user@trapyfy.com";
                const fiat = countryToFiat(client.country);
                const nRes = await api.niftipayCreate({
                    network: chain, asset, amount: total, currency: fiat,
                    firstName: client.firstName, lastName: client.lastName, email: safeEmail,
                    merchantId: activeOrg?.id ?? "", reference: data.orderKey,
                });
                if (!nRes.ok) {
                    const msg = await nRes.text();
                    if (!showFriendlyCreateOrderError(msg)) toast.error(`Niftipay: ${msg}`);
                    return;
                }
                const meta = await nRes.json();
                await api.patchOrder(data.id, { orderMeta: [meta] });
                toast.success(`Niftipay invoice created: send ${meta?.order?.amount} ${asset}`);
            }

            cancelOrder();
            // return new order id for caller to navigate if they want
            return data.id as string;
        } catch (e: any) {
            if (!showFriendlyCreateOrderError(e?.message)) toast.error(e?.message || "Could not create order");
        }
    }, [
        orderGenerated, paymentMethods, shippingMethods, shippingCompanies, selectedPaymentMethod,
        niftipayNetworks, selectedNiftipay, addresses, selectedAddressId, selectedClient, clientCountry,
        shippingCost, itemsSubtotal, discountTotal, appliedCodes, couponTypeByCode, couponValues,
        activeOrg?.id, clients, searchResults, cancelOrder, cartId, total,
    ]);

    return {
        // state for UI
        clientsLoading, clients, filteredClients, searchResults, searching, searchTerm, setSearchTerm,
        selectedClient, pickClient,

        products, productsLoading, selectedProduct, setSelectedProduct,
        quantityText, setQuantityText,

        orderGenerated, generateOrder,
        orderItems, addProduct, removeProduct, updateQuantity,

        addresses, selectedAddressId, setSelectedAddressId, newAddress, setNewAddress, addAddress,

        couponCode, setCouponCode, appliedCodes, discountTotal, couponBreakdown, applyCoupon,

        shippingMethods, shippingCompanies, shippingLoading,
        selectedShippingMethod, setSelectedShippingMethod,
        selectedShippingCompany, setSelectedShippingCompany,
        shippingCost,

        paymentMethods, paymentLoading, selectedPaymentMethod, setSelectedPaymentMethod,
        niftipayNetworks, niftipayLoading, selectedNiftipay, setSelectedNiftipay,

        clientCountry, itemsSubtotal, totalBefore, total,

        createOrder, cancelOrder,
    };
}
