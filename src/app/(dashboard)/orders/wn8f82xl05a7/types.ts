export type NiftipayNet = { chain: string; asset: string; label: string };

export type Product = {
    id: string;
    variationId?: string | null;
    title: string;
    sku: string;
    description: string;
    regularPrice: Record<string, number>;
    price: number;
    image: string;
    stockData: Record<string, Record<string, number>>;
    allowBackorders?: boolean;
    isAffiliate?: boolean;
    categories?: string[];
    subtotal?: number;
};

export type OrderItem = { product: Product; quantity: number };

export type ShippingMethod = {
    id: string;
    title: string;
    description: string;
    costs: Array<{ minOrderCost: number; maxOrderCost: number; shipmentCost: number }>;
};

export type ShippingCompany = { id: string; name: string };

export type Address = { id: string; clientId: string; address: string };

export type PaymentMethod = {
    id: string;
    name: string;
    active?: boolean;
    details?: string;
    apiKey?: string | null;
};

export type CouponBreakdown = {
    code: string;
    discountType: "percentage" | "fixed";
    discountValue: number;
    discountAmount: number;
    subtotalAfter: number;
};
