# Personal Insolvency

**Bankruptcies, debt agreements and personal insolvency agreements for every Australian region since 2007 — mapped, ranked and explained.**

🔗 **Live:** [https://au-insolvency.benrichardson.dev](https://au-insolvency.benrichardson.dev)

## What is this?

The Australian Financial Security Authority publishes quarterly counts of every personal insolvency
in the country, broken down by the SA3 region where the debtor lived. It is one of the better
measures of household financial collapse available — and it is published as a raw CSV that nobody
has ever put on a map, converted into a comparable per-adult rate, or read carefully enough to
notice what it does not say.

This site does those three things. It ranks all 340 SA3 regions by insolvencies per 10,000 adults
over a rolling twelve months, maps them against real ABS boundaries, and plots each region's current
rate against its four-year trajectory — because a league table cannot distinguish a place that has
always struggled from one that is deteriorating fast, and those are different problems.

The headline finding is counter-intuitive: **personal insolvency has collapsed.** The most recent
quarter recorded 3,161 insolvencies against a peak of 9,863 in September 2009 — 68% lower, during a
cost-of-living crisis. Two things drove that, and neither is households becoming more solvent. The
June 2019 debt agreement reforms capped fees and tightened eligibility, removing the instrument that
had been absorbing much of the volume; pandemic support and creditor forbearance suppressed the
rest. What this dataset measures is entry into a *formal* process. When that process gets harder to
enter, distress does not leave the economy — it leaves the statistics.

## Who is this for?

Financial counsellors and community legal centres checking whether their catchment is running hot;
journalists covering cost-of-living and small-business failure; policy analysts at Treasury, AFSA
and state agencies; and anyone who wants to know whether the "everyone is going broke" narrative is
true where they actually live.

## Data Sources

| Source | What it provides | Update frequency |
|--------|-------------------|-----------------|
| [AFSA regional quarterly time series](https://www.afsa.gov.au/about-us/statistics-and-insights/quarterly-personal-insolvency-statistics) | 75 quarters × 340 SA3 regions × business/consumer flag | Quarterly |
| [AFSA quarterly personal insolvencies](https://www.afsa.gov.au/about-us/statistics-and-insights/quarterly-personal-insolvency-statistics) | Administration type × state × quarter | Quarterly |
| [ABS Estimated Resident Population](https://data.api.abs.gov.au/rest/data/ERP_ASGS2021) | Adult (15+) population by SA3 — the per-capita denominator | Annual |
| [ABS ASGS 2021 SA3 boundaries](https://geo.abs.gov.au/arcgis/rest/services/ASGS2021/SA3/MapServer) | Real region geometry for the map | Static |

## Features

- **Rankings** — every region by rate, count or four-year change, colour-coded against the national median
- **Map** — Leaflet choropleth of all 340 SA3s across four measures, with a skew-aware quantile ramp
- **Trajectory** — the signature view: current rate against four-year change, split into four quadrants by the national medians, with zoom/pan and click-to-drill
- **Explorer** — searchable, sortable table with a 75-quarter sparkline per region
- **Timeline** — nineteen years stacked by administration type, annotated with the events that bend the series
- **Kinds of insolvency** — how the bankruptcy / debt agreement / PIA mix shifted, plus creditor-forced vs voluntary bankruptcy and a state × type matrix
- **Business vs consumer** — the split, told at the level where it is actually reliable, with an explicit account of how much is withheld
- **Distribution** — the skew of rates across regions, click any bar to list the regions in it
- **Insights** — findings recomputed on every rebuild
- **Per-region drill-down** — hash-linkable (`#v=map&r=31501`), with full history, rank and suppression detail

## The four traps in this dataset

Each of these silently produces wrong numbers, and each is handled explicitly (see `pipeline/parse.mjs`):

1. **Aggregate rows masquerade as regions.** The `ASGS Code` column holds 364 values but only 340 are
   SA3s. Sixteen are greater-capital-city aggregates that *contain* those SA3s; ranking them together
   counts the country twice.
2. **`Total bankruptcies` is a subtotal**, equal to debtor's petitions plus sequestration orders, and
   `Total personal insolvencies` is a subtotal of everything. Summing the type column double-counts
   every bankruptcy. The pipeline asserts its leaf-type sum reproduces AFSA's own published total
   exactly (3,161 for March 2026) and fails the build if it ever drifts.
3. **`Data not available` is a string in a numeric column**, 18,908 times. `Number()` gives `NaN`,
   but `parseInt` and `Number(x) || 0` both give a convincing **0** — quietly deleting a fifth of the
   dataset while every total still looks plausible.
4. **Suppression is complementary, and a withheld cell is not a zero.** Where either side of the
   business/consumer split would identify someone, *both* sides are withheld so neither can be
   recovered by subtraction. Region totals are withheld too (8.9% of cells). Since AFSA publishes
   genuine zeros as `0`, a withheld quarter is 1 or 2 cases — so twelve-month totals for affected
   regions are shown as midpoint estimates with an explicit range, never as counts. Treating them as
   zero reported populous Sydney regions like Hawkesbury and Manly as having had *no insolvencies at
   all*.

A fifth quirk lives in the ABS age codes: **`A59` means ages 5–9**, not 55–59, and it sorts
innocently between `A55` and `A60`. Summing the adult bands by name puts primary schoolers in the
denominator.

## Tech Stack

- **Runtime:** Vanilla TypeScript
- **Build:** Vite 6
- **Testing:** Vitest (107 tests)
- **Hosting:** GitHub Pages (static, no backend)
- **Data:** GitHub Actions pipeline, quarterly to match AFSA's release cadence
- **Maps:** Leaflet 1.9 + ABS ASGS 2021 GeoJSON, simplified with mapshaper

## Local Development

```bash
# Install dependencies
npm install

# Start dev server
npm run dev

# Run tests
npm test

# Production build
npm run build

# Preview production build
npm run preview

# Refresh the data (writes public/data/)
cd pipeline && npm install
node pipeline/collect.mjs && node pipeline/aggregate.mjs
```

## How it works

`pipeline/collect.mjs` fetches the two AFSA CSVs, the ABS SDMX population extract and the ABS SA3
boundary service into `pipeline/tmp/`. `pipeline/aggregate.mjs` shapes them through the pure
functions in `pipeline/parse.mjs`, simplifies the boundaries with mapshaper, and writes
`public/data/{regions,national,meta}.json` plus `sa3.geojson`. The browser fetches those four files
and does everything else client-side.

All parsing logic lives in `pipeline/parse.mjs`, which is dependency-free so the test suite can
exercise the real code without touching the network. The aggregation step carries hard invariants —
too few regions, too few quarters, a drifting business-flag partition, or a national total that no
longer matches AFSA's own published subtotal all fail the build rather than shipping quietly wrong
data.

## License

MIT
