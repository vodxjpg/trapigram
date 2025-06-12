// src/lib/placeholder-meta.ts
/**
 * Plain placeholder definitions – **NO server imports here**.
 * Safe for the browser bundle.
 */
export const placeholderDefs = [
  {
    key: "review_summary",
    description: "Shows total reviews and % positive (e.g. “5 reviews (96 %)"
  },
  {
    key: "separator",
    description: "Use to split your text in many pages—please check the FAQ section to see an example.",
  },
  {
    key: "user_affiliate_referrals_count",
    description: "The number of users referred by the current affiliate user.",
  },
  {
    key: "user_affiliate_orders_count",
    description: "The number of confirmed orders placed by users referred by the affiliate.",
  },
  {
    key: "user_affiliate_level",
    description: "The affiliate level of the user.",
  },
  {
    key: "user_affiliate_points",
    description: "The number of points currently available to the affiliate user.",
  },
  {
    key: "user_affiliate_points_spent",
    description: "The number of points the affiliate user has already spent.",
  },
  {
    key: "user_affiliate_total_points",
    description: "The total number of points earned and spent by the affiliate user.",
  },
] as const;
