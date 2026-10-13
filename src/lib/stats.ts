/**
 * Continuous percentile with linear interpolation, the same definition as Postgres
 * `percentile_cont`: position (n - 1) * p in the ascending values. Null when empty.
 */
export function percentileCont(sortedAsc: readonly number[], p: number): number | null {
  const n = sortedAsc.length;
  if (n === 0) return null;
  const pos = (n - 1) * p;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sortedAsc[lo]! + (sortedAsc[hi]! - sortedAsc[lo]!) * (pos - lo);
}

/** Mean of the values, or null when there are none. */
export function mean(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}
