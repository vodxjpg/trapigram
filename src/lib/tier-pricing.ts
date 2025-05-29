import { db } from "@/lib/db"

/* ─── schemas ─────────────────────────── */
type Tier = {
    countries: string[];
    products: { productId: string; variationId: string | null }[];
    steps: { fromUnits: number; toUnits: number; price: string }[];
    // …other fields
};

export function getStepsFor(
    tiers: Tier[],
    country: string,
    productId: string
): Tier["steps"] {
    // Find the first tier that applies to this country
    // and contains the productId in its products array
    const tier = tiers.find(
        (t) =>
            t.countries.includes(country) &&
            t.products.some((p) => p.productId === productId)
    );
    return tier ? tier.steps : [];
}

export function getPriceForQuantity(
    steps: { fromUnits: number; toUnits: number; price: string }[],
    quantity: number
): string | null {
    const tier = steps.find(
        (s) => quantity >= s.fromUnits && quantity <= s.toUnits
    );
    return tier ? tier.price : null;
}

export async function tierPricing(organizationId) {
    const rows = await db
        .selectFrom("tierPricings")
        .selectAll()
        .where("organizationId", "=", organizationId)
        .execute()

    const tierPricings = await Promise.all(
        rows.map(async r => {
            const countries = typeof r.countries === "string" ? JSON.parse(r.countries || "[]") : r.countries

            const products = await db
                .selectFrom("tierPricingProducts")
                .select(["productId", "variationId"])
                .where("tierPricingId", "=", r.id)
                .execute()

            const steps = await db
                .selectFrom("tierPricingSteps")
                .select(["fromUnits", "toUnits", "price"])
                .where("tierPricingId", "=", r.id)
                .execute()

            return { ...r, countries, products, steps }
        }),
    )

    return tierPricings
} 