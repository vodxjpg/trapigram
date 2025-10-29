export function customerName(firstName: string | null | undefined, lastName: string | null | undefined): string {
  const f = (firstName ?? '').trim();
  const l = (lastName ?? '').trim();
  return `${f} ${l}`.trim();
}
