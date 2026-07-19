// Pure analysis over the dataset. No DOM, so the test suite can exercise the
// real logic that produces the Insights view.

import type { Dataset, National, Region } from './types';

export interface Insight {
  severity: 'alert' | 'warn' | 'info';
  title: string;
  body: string;
  /** Region code to drill into, when the insight is about one place. */
  code?: string;
}

export function median(values: number[]): number | null {
  const v = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!v.length) return null;
  const mid = v.length >> 1;
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

/** Sum a quarter's cells for one administration type across all states. */
export function typeTotal(national: National, qIndex: number, type: string): number {
  const cell = national.cells[qIndex] ?? {};
  let sum = 0;
  for (const key in cell) {
    const [t, state] = key.split('|');
    if (t === type && state !== 'Total') sum += cell[key];
  }
  return sum;
}

/** Sum a quarter across every administration type (the national total). */
export function quarterTotal(national: National, qIndex: number): number {
  const cell = national.cells[qIndex] ?? {};
  let sum = 0;
  for (const key in cell) {
    if (!key.endsWith('|Total')) sum += cell[key];
  }
  return sum;
}

/** Totals for one administration group (e.g. Bankruptcy = petition + order + estate). */
export function groupSeries(national: National, groupKey: string): number[] {
  const group = national.groups.find((g) => g.key === groupKey);
  if (!group) return national.quarters.map(() => 0);
  return national.quarters.map((_, i) =>
    group.types.reduce((a, t) => a + typeTotal(national, i, t), 0),
  );
}

export function ratedRegions(regions: Region[]): Region[] {
  return regions.filter((r) => r.rate !== null);
}

/**
 * The four quadrants of the trajectory view: current rate against four-year
 * change, each measured relative to the national median. This is the split the
 * site exists to make — "bad and getting worse" is a different problem from
 * "bad but improving", and a league table cannot tell them apart.
 */
export function quadrant(
  r: Region,
  medRate: number,
  medChange: number,
): 'entrenched' | 'emerging' | 'improving' | 'stable' | null {
  if (r.rate === null || r.change4y === null) return null;
  const hi = r.rate >= medRate;
  const rising = r.change4y >= medChange;
  if (hi && rising) return 'entrenched';
  if (!hi && rising) return 'emerging';
  if (hi && !rising) return 'improving';
  return 'stable';
}

export const QUADRANT_LABEL: Record<string, string> = {
  entrenched: 'High and rising',
  emerging: 'Low but rising fast',
  improving: 'High but falling',
  stable: 'Low and steady',
};

export function buildInsights(data: Dataset): Insight[] {
  const out: Insight[] = [];
  const { regions, national, meta } = data;
  const rated = ratedRegions(regions);
  if (!rated.length) return out;

  const medRate = meta.medians.rate;
  const byRate = [...rated].sort((a, b) => (b.rate ?? 0) - (a.rate ?? 0));

  // 1. The national collapse — the headline nobody expects.
  const totals = national.quarters.map((_, i) => quarterTotal(national, i));
  const peak = Math.max(...totals);
  const peakAt = totals.indexOf(peak);
  const latest = totals[totals.length - 1];
  const trough = Math.min(...totals);
  if (peak > 0 && latest < peak * 0.75) {
    out.push({
      severity: 'info',
      title: `Personal insolvencies are ${Math.round((1 - latest / peak) * 100)}% below their peak`,
      body:
        `The most recent quarter recorded ${latest.toLocaleString('en-AU')} personal insolvencies, against a peak of ` +
        `${peak.toLocaleString('en-AU')} in ${label(national.quarters[peakAt])} and a low of ${trough.toLocaleString('en-AU')}. ` +
        `Despite sustained cost-of-living pressure, formal insolvency remains far below its pre-2020 level — ` +
        `the fall began with the 2019 debt agreement reforms and accelerated through the pandemic support period.`,
    });
  }

  // 2. Worst region.
  const worst = byRate[0];
  if (worst?.rate) {
    out.push({
      severity: 'alert',
      title: `${worst.name} has the highest rate in the country`,
      body:
        `${worst.total12.toLocaleString('en-AU')} personal insolvencies in the last twelve months — ` +
        `${worst.rate.toFixed(1)} per 10,000 adults, ${(worst.rate / medRate).toFixed(1)}× the national median of ${medRate.toFixed(1)}.`,
      code: worst.code,
    });
  }

  // 3. Concentration: how few regions carry how much.
  const sortedCount = [...rated].sort((a, b) => b.total12 - a.total12);
  const nat = sortedCount.reduce((a, r) => a + r.total12, 0);
  let acc = 0;
  let n = 0;
  while (n < sortedCount.length && acc < nat * 0.25) acc += sortedCount[n++].total12;
  if (n > 0 && nat > 0) {
    out.push({
      severity: 'info',
      title: `${n} of ${rated.length} regions account for a quarter of all insolvencies`,
      body:
        `Personal insolvency is geographically concentrated: the ${n} worst-affected SA3s carry ` +
        `${Math.round((acc / nat) * 100)}% of the national total between them.`,
    });
  }

  // 4. Fastest deterioration.
  const rising = rated
    .filter((r) => r.change4y !== null && r.total12 >= 25)
    .sort((a, b) => (b.change4y ?? 0) - (a.change4y ?? 0));
  if (rising.length && (rising[0].change4y ?? 0) > 0.5) {
    const r = rising[0];
    out.push({
      severity: 'warn',
      title: `${r.name} is deteriorating fastest`,
      body:
        `Insolvencies there are up ${Math.round((r.change4y ?? 0) * 100)}% over four years ` +
        `(${r.total12.toLocaleString('en-AU')} in the last twelve months), against a national median change of ` +
        `${Math.round(meta.medians.change4y * 100)}%.`,
      code: r.code,
    });
  }

  // 5. Debt agreements — the reform effect hiding inside a flat total.
  const da = groupSeries(national, 'Debt agreement');
  const daPeak = Math.max(...da);
  const daNow = da[da.length - 1];
  if (daPeak > 0 && daNow < daPeak * 0.7) {
    out.push({
      severity: 'info',
      title: `Debt agreements have fallen ${Math.round((1 - daNow / daPeak) * 100)}% from their peak`,
      body:
        `Debt agreements peaked at ${daPeak.toLocaleString('en-AU')} in a quarter and now run ${daNow.toLocaleString('en-AU')}. ` +
        `The June 2019 reforms capped fees and tightened eligibility, and the instrument never recovered — ` +
        `a shift invisible in the headline total, which blends it with bankruptcy.`,
    });
  }

  // 6. Creditor-driven bankruptcy — who is being forced under.
  const petitions = national.quarters.map((_, i) => typeTotal(national, i, "Debtor's petition"));
  const orders = national.quarters.map((_, i) => typeTotal(national, i, 'Sequestration order'));
  const shareNow = orders.at(-1)! / Math.max(1, orders.at(-1)! + petitions.at(-1)!);
  const shareThen = orders[0] / Math.max(1, orders[0] + petitions[0]);
  if (Number.isFinite(shareNow) && Number.isFinite(shareThen) && Math.abs(shareNow - shareThen) > 0.03) {
    const up = shareNow > shareThen;
    out.push({
      severity: up ? 'warn' : 'info',
      title: `${Math.round(shareNow * 100)}% of bankruptcies are now creditor-forced`,
      body:
        `Sequestration orders — where a creditor goes to court to force someone into bankruptcy rather than the ` +
        `person filing themselves — make up ${Math.round(shareNow * 100)}% of bankruptcies, ` +
        `${up ? 'up' : 'down'} from ${Math.round(shareThen * 100)}% at the start of the series.`,
    });
  }

  // 7. The split we cannot see — disclosed rather than quietly dropped.
  if (meta.counts.splitCoverageNational < 0.95) {
    out.push({
      severity: 'info',
      title: `The business/consumer split is withheld for ${Math.round((1 - meta.counts.splitCoverageNational) * 100)}% of insolvencies`,
      body:
        `AFSA suppresses that split in pairs wherever either side would identify someone, so it cannot be recovered ` +
        `by subtraction. Only ${meta.counts.splitPublishedRegions} of ${meta.counts.regions} regions have enough ` +
        `published detail to state a business share, which is why that measure appears only where it is sound.`,
    });
  }

  // 8. Where formal insolvency is rare — and why that is not the same as thriving.
  //
  // Only regions whose whole window was PUBLISHED can be called zero. A region
  // with withheld quarters has an unknown small number, not none: Hawkesbury and
  // Manly had three of four quarters withheld and would otherwise be announced
  // here as having had no insolvencies at all.
  const lowest = byRate.filter((r) => r.total12 > 0).at(-1);
  const zeros = rated.filter((r) => r.exact && r.total12 === 0);
  if (zeros.length) {
    out.push({
      severity: 'info',
      title: `${zeros.length} region${zeros.length > 1 ? 's' : ''} recorded no insolvencies at all`,
      body:
        `${zeros.slice(0, 3).map((r) => r.name).join(', ')}${zeros.length > 3 ? ' and others' : ''} recorded none in the last twelve months, ` +
        `with every quarter published rather than withheld. A low rate is not automatically a sign of prosperity — ` +
        `several of these are remote communities where formal insolvency is rarely used at all, and hardship shows up ` +
        `in ways this dataset cannot see.` +
        (lowest ? ` The lowest non-zero rate is ${lowest.name} at ${lowest.rate?.toFixed(1)} per 10,000 adults.` : ''),
    });
  }

  // 9. How much of the map is an estimate rather than a count.
  const inexact = regions.filter((r) => !r.exact).length;
  if (inexact > 0) {
    out.push({
      severity: 'info',
      title: `${inexact} regions have at least one withheld quarter`,
      body:
        `AFSA withholds a region's quarterly count when it is small enough to identify someone, and publishes genuine ` +
        `zeros as zero — so a withheld quarter is one or two cases, never none. Twelve-month totals for these regions ` +
        `are midpoint estimates accurate to within about half a case per withheld quarter, not hard counts, and are ` +
        `marked as such throughout.`,
    });
  }

  return out;
}

function label(index: number): string {
  const year = Math.floor(index / 4);
  const q = (index % 4) + 1;
  return `${['Mar', 'Jun', 'Sep', 'Dec'][q - 1]} ${year}`;
}
