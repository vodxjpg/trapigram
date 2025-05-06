// -----------------------------------------------------------------
//  Helper to convert FE <‑‑> DB structure
// -----------------------------------------------------------------
export type CountryPts   = { regular: number; sale: number | null };
export type PointsByCtry = Record<string, CountryPts>;           // ES, IT …
export type PointsByLvl  = Record<string /* levelId | "default" */, PointsByCtry>;

export function splitPointsByLevel(src: PointsByLvl) {
  const regular: Record<string, Record<string, number>> = {};
  const sale   : Record<string, Record<string, number>> = {};
  for (const [lvl, byCtry] of Object.entries(src)) {
    regular[lvl] = {};
    for (const [c, v] of Object.entries(byCtry)) {
      regular[lvl][c] = v.regular;
      if (v.sale != null) {
        if (!sale[lvl]) sale[lvl] = {};
        sale[lvl][c] = v.sale;
      }
    }
  }
  return { regularPoints: regular, salePoints: Object.keys(sale).length ? sale : null };
}

export function mergePointsByLevel(
  regular: Record<string, Record<string, number>> | null,
  sale   : Record<string, Record<string, number>> | null,
): PointsByLvl {
  const out: PointsByLvl = {};
  const r = regular || {};
  const s = sale || {};
  for (const [lvl, byCtry] of Object.entries(r)) {
    out[lvl] = {};
    for (const [c, n] of Object.entries(byCtry))
      out[lvl][c] = { regular: Number(n), sale: null };
  }
  for (const [lvl, byCtry] of Object.entries(s))
    for (const [c, n] of Object.entries(byCtry))
      out[lvl] = {
        ...(out[lvl] || {}),
        [c]: { ...(out[lvl]?.[c] || { regular: 0, sale: null }), sale: Number(n) },
      };
  return out;
}
