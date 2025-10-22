// src/lib/currency.ts

const euroCountries = [
  "AT", // Austria
  "BE", // Belgium
  "HR", // Croatia (now uses EUR)
  "CY", // Cyprus
  "EE", // Estonia
  "FI", // Finland
  "FR", // France
  "DE", // Germany
  "GR", // Greece
  "IE", // Ireland
  "IT", // Italy
  "LV", // Latvia
  "LT", // Lithuania
  "LU", // Luxembourg
  "MT", // Malta
  "NL", // Netherlands
  "PT", // Portugal
  "SK", // Slovakia
  "SI", // Slovenia
  "ES"  // Spain
];


// minimal alias map so "UK" is treated as "GB" (common in data)
const COUNTRY_ALIAS: Record<string, string> = {
  UK: "GB",
};

export type SupportedCcy = "EUR" | "GBP" | "USD";

/** Resolve currency from a (possibly aliased) country code */
export function currencyForCountry(countryCode?: string): SupportedCcy {
  const ccRaw = countryCode?.toUpperCase() ?? "";
  const cc = COUNTRY_ALIAS[ccRaw] ?? ccRaw;
  if (euroCountries.includes(cc)) return "EUR";
  if (cc === "GB") return "GBP";
  return "USD";
}
/**
 * Formats a number as currency based on country code.
 * - Euro countries use EUR (€)
 * - United Kingdom uses GBP (£)
 * - All others use USD ($)
 */
export function formatCurrency(
  amount: number,
  countryCode?: string
): string {
  const currency = currencyForCountry(countryCode);

  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
  }).format(amount);
}


/**
 * Back-compat name used by pages:
 * Same behavior as formatCurrency, just exported under the name
 * pages expect (so pages don’t declare their own named exports).
 */
export function formatMoneyByCountry(
  amount: number,
  countryCode?: string
): string {
  return formatCurrency(amount, countryCode);
}