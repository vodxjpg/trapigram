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
    const cc = countryCode?.toUpperCase() ?? "";
    const currency = euroCountries.includes(cc)
      ? "EUR"
      : cc === "GB"
      ? "GBP"
      : "USD";
  
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
    }).format(amount);
  }
  