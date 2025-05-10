// src/lib/placeholders.ts
import { db } from "@/lib/db";
import { placeholderDefs } from "./placeholder-meta";

/* -------------------------------------------------- */
/*  Map key → async resolver (server-only)            */
/* -------------------------------------------------- */
type Resolver = (orgId: string) => Promise<string>;

export const placeholderResolvers: Record<string, Resolver> = {
  review_summary: async (organizationId) => {
    const reviews = await db
      .selectFrom("reviews")
      .select(["rate"])
      .where("organizationId", "=", organizationId)
      .execute();

    const total = reviews.length;
    if (total === 0) return "No reviews yet";

    let positive = 0,
      neutral = 0,
      negative = 0;
    reviews.forEach(({ rate }) => {
      const r = String(rate).toLowerCase();
      if (r === "positive" || r === "5" || r === "4") positive++;
      else if (r === "neutral" || r === "3") neutral++;
      else negative++;
    });

    const pct = Math.round((positive / total) * 100);
    return `${total} review${total > 1 ? "s" : ""} (${pct} %)`;
  },
};

/* ---------------------------------------------- */
export { placeholderDefs }; // re-export for server use

/*  Helper to replace tokens in HTML              */
export async function resolvePlaceholders(
  html: string,
  organizationId: string,
): Promise<string> {
  const matches = [...html.matchAll(/\{([a-z0-9_]+)\}/gi)];
  if (matches.length === 0) return html;

  const keys = [...new Set(matches.map((m) => m[1]))];
  const replacements: Record<string, string> = {};

  await Promise.all(
    keys.map(async (k) => {
      const fn = placeholderResolvers[k];
      if (fn) replacements[k] = await fn(organizationId);
    }),
  );

  let out = html;
  for (const [k, v] of Object.entries(replacements)) {
    out = out.replaceAll(`{${k}}`, v);
  }
  return out;
}
