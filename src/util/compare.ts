/** Locale-independent string comparison, so ordering never depends on the host environment. */
export function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
