export interface Bin {
  lo: number;
  hi: number;
  count: number;
}

/**
 * Equal-width bins over [0, max]. Equal width (not quantile) on purpose: the
 * point of this view is to show the skew, and quantile bins would flatten the
 * very shape it exists to reveal.
 *
 * The top bin is inclusive of `max` so the largest value is never dropped —
 * a half-open interval silently loses the single worst region.
 */
export function histogram(values: number[], binCount = 16): Bin[] {
  const finite = values.filter((v) => Number.isFinite(v));
  if (!finite.length || binCount < 1) return [];
  const max = Math.max(...finite);
  if (max <= 0) return [{ lo: 0, hi: 1, count: finite.length }];

  const width = max / binCount;
  const bins: Bin[] = Array.from({ length: binCount }, (_, i) => ({
    lo: i * width,
    hi: (i + 1) * width,
    count: 0,
  }));
  for (const v of finite) {
    const i = Math.min(binCount - 1, Math.floor(v / width));
    bins[i].count++;
  }
  return bins;
}
