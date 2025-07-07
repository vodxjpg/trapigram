import { db } from "@/lib/db";

/* ─── type ───────────────────────────── */
export type Tier = {
  id?: string;
  name?: string;
  countries: string[];
  products: { productId: string; variationId: string | null }[];
  steps: { fromUnits: number; toUnits: number; price: number }[];
};

/* ─── helpers ────────────────────────── */
export async function tierPricing(organizationId: string): Promise<Tier[]> {
  const rows = await db
    .selectFrom("tierPricings")
    .selectAll()
    .where("organizationId", "=", organizationId)
    .execute();

  const tierPricings: Tier[] = await Promise.all(
    rows.map(async (r) => {
      const countries: string[] =
        typeof r.countries === "string" ? JSON.parse(r.countries || "[]") : r.countries;

      const products = await db
        .selectFrom("tierPricingProducts")
        .select(["productId", "variationId"])
        .where("tierPricingId", "=", r.id)
        .execute();

      const rawSteps = await db
        .selectFrom("tierPricingSteps")
        .select(["fromUnits", "toUnits", "price"])
        .where("tierPricingId", "=", r.id)
        .execute();

      const steps = rawSteps.map((s) => ({
        fromUnits: Number(s.fromUnits),
        toUnits: Number(s.toUnits),
        price: Number(s.price),
      }));

      return { ...r, countries, products, steps };
    }),
  );

  return tierPricings;
}

export function getStepsFor(
  tiers: Tier[],
  country: string,
  productId: string,
): Tier["steps"] {
  const tier = tiers.find(
    (t) =>
      t.countries.includes(country) &&
      t.products.some(
        (p) => p.productId === productId || p.variationId === productId,
      ),
  );
  return tier ? tier.steps : [];
}

export function getPriceForQuantity(
  steps: { fromUnits: number; toUnits: number; price: number }[],
  quantity: number,
): number | null {
  const step = steps.find(
    (s) => quantity >= s.fromUnits && quantity <= s.toUnits,
  );
  return step ? step.price : null;
}
