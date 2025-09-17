import { db } from "@/lib/db";

/* ─── types ────────────────────────────────────────────────────────── */
export type Tier = {
  id?: string;
  name?: string;
  active?: boolean;
  createdAt?: Date | string;
  countries: string[];
  // productId OR variationId may be set (the other null)
  products: { productId: string | null; variationId: string | null }[];
  steps: { fromUnits: number; toUnits: number; price: number }[];
  /**
   * If empty or undefined → tier applies to everyone (general rule).
   * If non-empty → tier applies ONLY to those customer IDs.
   */
  customers?: string[];
};

/* ─── fetch helpers ────────────────────────────────────────────────── */
/**
 * Load all ACTIVE tier-pricing rules for an organization.
 * Includes countries, products, steps, and (NEW) customers.
 */
export async function tierPricing(organizationId: string): Promise<Tier[]> {
  const rows = await db
    .selectFrom("tierPricings")
    .selectAll()
    .where("organizationId", "=", organizationId)
    .where("active", "=", true) // only active rules
    .orderBy("createdAt", "desc")
    .execute();

  const tiers: Tier[] = await Promise.all(
    rows.map(async (r) => {
      // countries can be jsonb or stringified json
      const countries: string[] =
        typeof (r as any).countries === "string"
          ? JSON.parse((r as any).countries || "[]")
          : (r as any).countries || [];

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

      // NEW: load targeted customers (if any)
      // expects a join table: tierPricingCustomers(tierPricingId, clientId)
      let customers: string[] = [];
      try {
        const custRows = await db
          .selectFrom("tierPricingCustomers")
          .select(["clientId"])
          .where("tierPricingId", "=", r.id)
          .execute();
        customers = custRows.map((c: any) => String(c.clientId));
      } catch {
        // If the table doesn't exist yet, just leave customers empty (= general rule).
        customers = [];
      }

      return {
        ...r,
        countries,
        products: products.map((p) => ({
          productId: p.productId ?? null,
          variationId: p.variationId ?? null,
        })),
        steps,
        customers,
      } as Tier;
    })
  );

  return tiers;
}

/* ─── matching helpers ─────────────────────────────────────────────── */
/**
 * Select steps for a given country & product/variation.
 * If `customerId` is provided:
 *   1) Prefer tiers that explicitly target that customer.
 *   2) Fallback to general tiers (with no customers).
 * Among equals, the newest (createdAt desc) wins (array is already ordered).
 */
export function getStepsFor(
  tiers: Tier[],
  country: string,
  productOrVariationId: string,
  customerId?: string
): Tier["steps"] {
  if (!Array.isArray(tiers) || tiers.length === 0) return [];

  const matchesBase = (t: Tier) => {
    const inCountry = t.countries?.includes(country);
    const matchesProduct = t.products?.some(
      (p) => p.productId === productOrVariationId || p.variationId === productOrVariationId
    );
    return inCountry && matchesProduct;
  };

  // Split by customer targeting
  const targeted = tiers.filter(
    (t) =>
      matchesBase(t) &&
      Array.isArray(t.customers) &&
      t.customers.length > 0 &&
      (customerId ? t.customers.includes(customerId) : false)
  );

  const general = tiers.filter(
    (t) => matchesBase(t) && (!Array.isArray(t.customers) || t.customers.length === 0)
  );

  // Prefer targeted tiers, else general
  const chosen = (targeted.length ? targeted : general)[0];
  return chosen ? chosen.steps : [];
}

/**
 * Given steps and a quantity, return the matched price.
 * Inclusive range matching: fromUnits ≤ quantity ≤ toUnits
 */
export function getPriceForQuantity(
  steps: { fromUnits: number; toUnits: number; price: number }[],
  quantity: number
): number | null {
  const step = steps.find(
    (s) => quantity >= Number(s.fromUnits) && quantity <= Number(s.toUnits)
  );
  return step ? Number(step.price) : null;
}
