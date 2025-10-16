// small wrappers so components/hooks stay tidy
export const api = {
    clients: (q = "", page = 1, pageSize = 10) =>
        fetch(`/api/clients?search=${encodeURIComponent(q)}&page=${page}&pageSize=${pageSize}`, {
            headers: { "x-internal-secret": process.env.NEXT_PUBLIC_INTERNAL_API_SECRET ?? "" },
        }).then(r => r.json()),

    clientAddresses: (clientId: string) =>
        fetch(`/api/clients/${clientId}/address`, {
            headers: { "x-internal-secret": process.env.NEXT_PUBLIC_INTERNAL_API_SECRET ?? "" },
        }).then(r => r.json()),

    products: (q = "", page = 1, pageSize = 1000) =>
        fetch(`/api/products?${q ? `search=${encodeURIComponent(q)}&` : ""}page=${page}&pageSize=${pageSize}`).then(r => r.json()),

    affiliateProducts: (q = "", limit = 1000) =>
        fetch(`/api/affiliate/products?${q ? `search=${encodeURIComponent(q)}&` : ""}limit=${limit}`).then(r => r.json()),

    categoriesAll: () =>
        fetch("/api/product-categories?all=1").then(r => r.json()),

    shipments: () =>
        fetch("/api/shipments", {
            headers: { "x-internal-secret": process.env.NEXT_PUBLIC_INTERNAL_API_SECRET ?? "" },
        }).then(r => r.json()),

    shippingCompanies: () =>
        fetch("/api/shipping-companies", {
            headers: { "x-internal-secret": process.env.NEXT_PUBLIC_INTERNAL_API_SECRET ?? "" },
        }).then(r => r.json()),

    paymentMethods: () =>
        fetch("/api/payment-methods", {
            headers: { "x-internal-secret": process.env.NEXT_PUBLIC_INTERNAL_API_SECRET ?? "" },
        }).then(r => r.json()),

    niftipayMethods: () =>
        fetch("/api/niftipay/payment-methods").then(r => r.json()),

    // cart ops
    createCart: (body: any) =>
        fetch("/api/cart", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then(r => r.json()),
    getCart: (id: string) => fetch(`/api/cart/${id}`).then(r => r.json()),
    addToCart: (id: string, body: any) =>
        fetch(`/api/cart/${id}/add-product`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
    removeFromCart: (id: string, body: any) =>
        fetch(`/api/cart/${id}/remove-product`, {
            method: "DELETE", headers: {
                "Content-Type": "application/json",
                "x-internal-secret": process.env.NEXT_PUBLIC_INTERNAL_API_SECRET ?? ""
            }, body: JSON.stringify(body)
        }),
    updateCartLine: (id: string, body: any) =>
        fetch(`/api/cart/${id}/update-product`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
    applyCoupon: (id: string, body: any) =>
        fetch(`/api/cart/${id}/apply-coupon`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),

    // order
    createOrder: (body: any) =>
        fetch("/api/order", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
    patchOrder: (id: string, body: any) =>
        fetch(`/api/order/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
    niftipayCreate: (body: any) =>
        fetch(`/api/niftipay/orders`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
};
