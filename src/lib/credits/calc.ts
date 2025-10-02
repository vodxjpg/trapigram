// src/lib/credits/calc.ts
/** Round half up to the nearest penny and return minor units (pence) as integer. */
export function toMinorGBP(amountDecimal: number): number {
  const pennies = Math.floor(Math.abs(amountDecimal) * 100 + 0.5) * Math.sign(amountDecimal);
  return pennies;
}
export function minorToDecimalString(minor: number): string {
  const sign = minor < 0 ? "-" : "";
  const n = Math.abs(minor);
  const pounds = Math.floor(n / 100);
  const pence = (n % 100).toString().padStart(2, "0");
  return `${sign}${pounds}.${pence}`;
}
