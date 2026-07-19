// Shape the raw files in tmp/ into the app's public/data JSON, and simplify the
// ABS SA3 boundaries with mapshaper (never by hand).

import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import mapshaper from 'mapshaper';
import {
  businessShare, median, parseCsvObjects, parseQuarter, quarterLabel, ratePer10k,
  rollingSum, shapeErp, shapeNational, shapeRegional, trailingSum, windowEstimate,
  POP_FLOOR,
} from './parse.mjs';

const TMP = join(import.meta.dirname, 'tmp');
const OUT = join(import.meta.dirname, '..', 'public', 'data');
mkdirSync(OUT, { recursive: true });

const read = (f) => readFileSync(join(TMP, f), 'utf8');

// ── regional ────────────────────────────────────────────────────────
const regionalRows = parseCsvObjects(read('regional.csv'));
const { quarters, regions, excluded } = shapeRegional(regionalRows);
if (regions.length < 300) {
  throw new Error(`only ${regions.length} SA3 regions parsed — refusing to ship partial data`);
}
if (quarters.length < 60) {
  throw new Error(`only ${quarters.length} quarters parsed — refusing to ship partial data`);
}

// Sanity check the split: where a cell IS published, Yes+No must equal Total.
// (Where it is suppressed they legitimately differ — that is what splitCovered
// tracks.) A drift among *published* cells would mean the partition changed
// meaning, and every business share downstream would be quietly wrong.
let publishedDrift = 0;
let publishedTotal = 0;
for (const r of regions) {
  for (let i = 0; i < quarters.length; i++) {
    if (!r.splitCovered[i]) continue;
    publishedTotal += r.total[i];
    publishedDrift += Math.abs(r.total[i] - (r.business[i] + r.consumer[i]));
  }
}
if (publishedTotal > 0 && publishedDrift / publishedTotal > 0.001) {
  throw new Error(
    `published-split drift ${((publishedDrift / publishedTotal) * 100).toFixed(2)}% — Yes+No no longer equals Total`,
  );
}

// ── population ──────────────────────────────────────────────────────
const erp = shapeErp(parseCsvObjects(read('erp.csv')));
if (Object.keys(erp.population).length < 300) {
  throw new Error(`only ${Object.keys(erp.population).length} SA3 populations — ERP incomplete`);
}

// ── boundaries (needed early, to know which codes have geometry) ─────
const rawGeo = read('sa3-raw.geojson');
const geoCmd =
  '-i raw.geojson ' +
  '-rename-fields code=sa3_code_2021,name=sa3_name_2021 ' +
  '-filter-fields code,name ' +
  '-simplify 1.3% keep-shapes ' +
  '-clean ' +
  '-o format=geojson precision=0.001 sa3.geojson';
const geoOut = await mapshaper.applyCommands(geoCmd, { 'raw.geojson': rawGeo });
const geoStr = geoOut['sa3.geojson'].toString();
writeFileSync(join(OUT, 'sa3.geojson'), geoStr);

// ── per-region metrics ──────────────────────────────────────────────
// The headline measure is a trailing FOUR-QUARTER total, not a single quarter:
// quarterly counts for a single SA3 are small and seasonal, and ranking on one
// noisy quarter reshuffles the leaderboard every release.
const LATEST_N = 4;
// A business share is only meaningful when most of the region's insolvencies
// actually had their split published. Below this it is a lower bound dressed up
// as a proportion, so the app hides it rather than drawing a misleading dot.
const MIN_SPLIT_COVERAGE = 0.7;

const est = (totals, known, offsetWindows = 0) => {
  const end = totals.length - offsetWindows * LATEST_N;
  return windowEstimate(totals.slice(0, end), known.slice(0, end), LATEST_N);
};

const rows = regions.map((r) => {
  const pop = erp.population[r.code] ?? null;
  const now = est(r.total, r.known, 0);
  const prev = est(r.total, r.known, 1);
  // 4 years back, so the trajectory axis spans the post-COVID period rather
  // than one noisy year-on-year step.
  const base = est(r.total, r.known, 4);
  const business12 = trailingSum(r.business, LATEST_N);
  const covered12 = trailingSum(r.splitCovered, LATEST_N);
  const total12 = now.mid;
  const splitCoverage = total12 > 0 ? covered12 / total12 : 0;

  return {
    code: r.code,
    name: r.name,
    state: r.state,
    pop,
    // Midpoint estimate; `published` is the hard floor and `withheld` says how
    // many of the four quarters AFSA suppressed.
    total12,
    published12: now.published,
    withheld12: now.withheld,
    exact: now.exact,
    lo12: now.lo,
    hi12: now.hi,
    prev12: prev.mid,
    change: prev.mid >= 10 ? (now.mid - prev.mid) / prev.mid : null,
    change4y: base.mid >= 10 ? (now.mid - base.mid) / base.mid : null,
    rate: ratePer10k(total12, pop),
    // Split-derived fields are null unless the split is actually well covered.
    splitCoverage,
    business12: splitCoverage >= MIN_SPLIT_COVERAGE ? business12 : null,
    bizShare: splitCoverage >= MIN_SPLIT_COVERAGE ? businessShare(business12, covered12) : null,
    // Rolling annualised series so a sparkline shows trend, not seasonality.
    series: rollingSum(r.total, LATEST_N),
  };
});

const rated = rows.filter((r) => r.rate !== null);
const withSplit = rows.filter((r) => r.bizShare !== null && r.total12 >= 20);
const medians = {
  rate: median(rated.map((r) => r.rate)),
  change4y: median(rated.map((r) => r.change4y).filter((x) => x !== null)),
  bizShare: median(withSplit.map((r) => r.bizShare)),
};

// ── national ────────────────────────────────────────────────────────
const nationalRows = parseCsvObjects(read('national.csv'));
const national = shapeNational(nationalRows);

// Invariant: our leaf-type sum must reproduce AFSA's own published
// `Total personal insolvencies` subtotal exactly. This is the check that
// catches a subtotal creeping back into the leaves (the double-count that
// `Total bankruptcies` caused) — it is arithmetic against the publisher's own
// number, so it cannot drift quietly.
{
  const lastQ = national.quarters[national.quarters.length - 1];
  const ours = Object.entries(national.cells[national.cells.length - 1])
    .filter(([k]) => !k.endsWith('|Total'))
    .reduce((a, [, v]) => a + v, 0);
  const theirs = nationalRows
    .filter((r) =>
      r['Type of personal insolvency administration'] === 'Total personal insolvencies' &&
      r['State'] === 'Total' && r['In a business or company'] === 'Total' &&
      parseQuarter(r['Quarter'])?.index === lastQ)
    .reduce((a, r) => a + (Number(r['Number of people entering a new personal insolvency']) || 0), 0);
  if (theirs > 0 && ours !== theirs) {
    throw new Error(
      `national total mismatch for ${quarterLabel(lastQ)}: computed ${ours}, AFSA published ${theirs}`,
    );
  }
  console.log(`  invariant OK: ${quarterLabel(lastQ)} total ${ours} matches AFSA's published subtotal`);
}

const meta = {
  generated: new Date().toISOString(),
  quarters,
  quarterLabels: quarters.map(quarterLabel),
  latestQuarter: quarterLabel(quarters[quarters.length - 1]),
  firstQuarter: quarterLabel(quarters[0]),
  erpYear: erp.year,
  popFloor: POP_FLOOR,
  windowQuarters: LATEST_N,
  minSplitCoverage: MIN_SPLIT_COVERAGE,
  counts: {
    regions: rows.length,
    rated: rated.length,
    suppressed: rows.length - rated.length,
    quarters: quarters.length,
    // Disclosed rather than hidden: these are real insolvencies that no ranking
    // or map can show because AFSA could not code the debtor's address.
    unknownAddress: excluded.unknown,
    nationalTotal12: Math.round(rows.reduce((a, r) => a + r.total12, 0)),
    // Regions whose last four quarters were all published, vs those where at
    // least one was withheld and the total is therefore an estimate.
    exactRegions: rows.filter((r) => r.exact).length,
    withheldQuarterCells: rows.reduce((a, r) => a + r.withheld12, 0),
    // How much of the business/consumer split survives complementary suppression.
    splitPublishedRegions: withSplit.length,
    splitCoverageNational:
      rows.reduce((a, r) => a + r.total12 * r.splitCoverage, 0) /
      Math.max(1, rows.reduce((a, r) => a + r.total12, 0)),
  },
  medians,
  source: {
    afsa: 'https://www.afsa.gov.au/about-us/statistics-and-insights/quarterly-personal-insolvency-statistics',
    abs: 'https://data.api.abs.gov.au/rest/data/ERP_ASGS2021',
    boundaries: 'https://geo.abs.gov.au/arcgis/rest/services/ASGS2021/SA3/MapServer',
  },
};

writeFileSync(join(OUT, 'regions.json'), JSON.stringify(rows));
writeFileSync(join(OUT, 'national.json'), JSON.stringify(national));
writeFileSync(join(OUT, 'meta.json'), JSON.stringify(meta, null, 2));

const kb = (f) => Math.round(statSync(join(OUT, f)).size / 1024);
console.log('Wrote:');
console.log('  regions.json ', kb('regions.json'), 'KB (', rows.length, 'SA3s,', rated.length, 'rated )');
console.log('  national.json', kb('national.json'), 'KB (', national.quarters.length, 'quarters )');
console.log('  sa3.geojson  ', kb('sa3.geojson'), 'KB');
console.log('  meta.json    ', kb('meta.json'), 'KB');
console.log(`  window: ${meta.firstQuarter} .. ${meta.latestQuarter}, ERP ${erp.year}`);
console.log(`  median rate ${medians.rate?.toFixed(1)} /10k adults, median 4y change ${(medians.change4y * 100).toFixed(1)}%`);
console.log(`  split: ${withSplit.length} regions usable, ${(meta.counts.splitCoverageNational * 100).toFixed(1)}% of insolvencies have a published split`);
console.log(`  excluded from rankings: ${excluded.aggregate} in aggregate rows, ${excluded.unknown} uncoded-address`);
