/** Linear-interpolation quantile (the common "type 7" definition) of sorted values. */
export function quantile(sorted: number[], q: number): number {
  if (!sorted.length) return NaN;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

export type Stat = { n: number; p10: number; p25: number; p50: number; p75: number; p90: number };

export function summarizeValues(values: (number | null | undefined)[]): Stat | null {
  const v = values.filter((x): x is number => typeof x === "number" && Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  return { n: v.length, p10: quantile(v, 0.1), p25: quantile(v, 0.25), p50: quantile(v, 0.5), p75: quantile(v, 0.75), p90: quantile(v, 0.9) };
}

/** Share of reference values strictly below x, plus half the ties (mid-rank percentile, 0–1). */
export function percentileOf(sortedRef: number[], x: number): number {
  if (!sortedRef.length) return NaN;
  let below = 0;
  let equal = 0;
  for (const v of sortedRef) {
    if (v < x) below++;
    else if (v === x) equal++;
  }
  return (below + equal / 2) / sortedRef.length;
}
