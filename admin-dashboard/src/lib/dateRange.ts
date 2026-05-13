/**
 * Convert a `yyyy-MM-dd` date input value (interpreted in the user's local
 * timezone) into an ISO string. `new Date("yyyy-MM-dd")` parses as UTC
 * midnight, which silently shifts the analytics window for any timezone west
 * of UTC.
 */
export function localDateToIsoStart(date: string): string | undefined {
  if (!date) return undefined;
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d, 0, 0, 0, 0).toISOString();
}

export function localDateToIsoEnd(date: string): string | undefined {
  if (!date) return undefined;
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d, 23, 59, 59, 999).toISOString();
}
