# Site Plan: Personal Insolvency

## Overview
- **Name:** Personal Insolvency
- **Repo name:** au-insolvency
- **Tagline:** Where Australians go broke — bankruptcies, debt agreements and personal insolvency agreements for every SA3 region, 2007 to now.

## Target Audience
Financial counsellors and community legal centres who need to know whether their catchment is
running hot; journalists covering cost-of-living and small-business failure; policy analysts at
Treasury/AFSA/state agencies; and the reasonably-informed public who want to know if the "everyone
is going broke" narrative is actually true where they live. Desktop-first for the analysts, but the
rankings and drill-down must work on a phone.

## Value Proposition
AFSA publishes the numbers but only as a raw CSV and a set of static PDF reports. Nobody has ever
put the regional series on a map, converted it to a comparable per-adult rate, or separated the two
completely different phenomena buried in the same column: **business-related** insolvency (a small
business failed and took the owner down with it) and **consumer** insolvency (personal debt
collapse with no business involved). Those two have different geographies, different causes and
different policy responses, and every published treatment of this data blends them.

The second thing nobody has surfaced: personal insolvency in Australia **collapsed** during COVID
and never recovered. Quarterly insolvencies ran ~8,200 in 2017 and ~3,100 today, despite a
cost-of-living crisis. That counter-intuitive fact is the site's headline, and it needs the long
series plus the administration-type mix to explain it (the 2019 debt agreement reforms did as much
as COVID did).

## Data Sources
| Source | URL | What it provides | Update frequency | Auth required? |
|--------|-----|-------------------|-----------------|----------------|
| AFSA regional quarterly time series | afsa.gov.au/sites/default/files/2024-08/regional_quarterly_time_series.csv | 81,900 rows: quarter × SA3 × business-flag × count, Dec-2007 → Mar-2026 | Quarterly | No |
| AFSA quarterly personal insolvencies | afsa.gov.au/sites/default/files/2024-08/quarterly_personal_insolvencies.csv | quarter × administration type × state × business-flag | Quarterly | No |
| ABS ERP by SA3 and age (SDMX) | data.api.abs.gov.au/rest/data/ERP_ASGS2021 | Adult population denominator for per-capita rates | Annual | No |
| ABS ASGS 2021 SA3 boundaries | geo.abs.gov.au/arcgis/.../ASGS2021/SA3/MapServer/1 | Real SA3 polygons (generalised layer 1) | Static | No |

Both AFSA CSVs are served from a **stable overwrite URL** — the `2024-08` path still carries
Mar-2026 data, so the pipeline can fetch the same URL each quarter.

## Data traps (found during research — these silently corrupt every figure)
1. **Aggregate rows masquerade as regions.** The `ASGS Code` column has 364 distinct values but only
   ~340 are real SA3s. 16 are GCCSA aggregates (`1GSYD` Greater Sydney, `1RNSW` Rest of NSW, …) and
   8 are `"NSW - not in ASGS"` unknown-address buckets. Ranking or mapping these alongside real SA3s
   double-counts the entire country. **Rule: only numeric 5-digit codes are regions.** The `not in
   ASGS` rows are still counted in national totals (they are real people) but are excluded from every
   ranking, map and rate, and their volume is disclosed.
2. **The business flag includes its own subtotal.** `In a business or company` takes `Yes`, `No` **and
   `Total`**. Summing the column double-counts. **Rule: read `Total` for totals, and derive business
   share as `Yes / Total`** — never `Yes / (Yes + No)`, which differs when a record is unclassified.
3. **Suppression.** AFSA does not publish SA3 cells with fewer than 3 insolvencies. Small regions
   therefore read 0 when the truth is 1–2. Rates are computed on a population floor and suppressed —
   not clamped — below it.
4. **Series start.** The regional file starts **Dec-2007**, not Sep-2007. Quarters are `Mmm-YY`
   strings that sort lexically wrong; they must be parsed to a real date.

## Key Features
1. **Business-vs-Consumer scatter** (signature) — per-adult insolvency rate against business-related
   share, with national medians as crosshairs. Separates small-business failure belts from consumer
   debt distress. Zoom/pan, click to drill down.
2. **SA3 choropleth** across 5 measures (rate, count, business share, business rate, consumer rate).
3. **Rankings leaderboard** — default per-adult rate, colour-coded against the national median.
4. **Explorer** — searchable/sortable table of every SA3 with 75-quarter sparklines.
5. **National timeline** — 75 quarters stacked by administration type, annotated with the 2019 debt
   agreement reforms, COVID moratorium, and the cost-of-living period.
6. **Administration mix** — how bankruptcy / debt agreement / PIA shares shifted, by state.
7. **State × administration-type matrix heatmap.**
8. **Distribution histogram** with click-through into a filtered Explorer.
9. **Auto-detected insights.**
10. **Per-SA3 drill-down** with hash routing (`#r=10102`), quarterly history, business split, rank.

## Style Direction
**Tone:** civic / serious but not bleak. This is a subject where real people are having the worst
year of their lives; the design must not gamify it or use alarm-red as decoration.
**Colour palette:** light, near-white base (`#fbfaf8`) with a deep indigo-slate primary and a muted
amber/teal pair for the business-vs-consumer duality. Red is reserved strictly for genuine
above-median distress, never for chrome.
**UI density:** balanced — denser than a consumer app, lighter than a terminal.
**Dark/light theme:** light. Civic/public audience, and financial counsellors read this in an office.
**Reference sites for tone:** ABS Data Explorer's cleaner pages; the fleet's own au-welfare (same
"rate vs composition" analytical shape, same civic register).

## Technical Architecture
- **Stack:** Vanilla TypeScript + Vite
- **Data strategy:** pipeline. Source is **quarterly** → cron runs quarterly (`1,4,7,10`), staggered
  to day 9 at 04:23 UTC.
- **Key libraries:** Leaflet (map only). Everything else hand-rolled SVG from `patterns/`.

## Layout
Fixed 52px header (title, nav tabs, About `?`). Main content max-width 1600px. Views swap in the
main region. Drill-down is a right-hand slide-in panel above the map's stacking context. Sticky
footer. Below 768px: nav scrolls horizontally, cards stack, table becomes card rows, all
wide-by-nature views get their own `overflow-x: auto` scroller.

## Visualization Strategy
- **Scatter (rate × business share)** — the only form that separates the two phenomena. A ranking
  cannot: Queanbeyan and a mining SA3 can post identical rates for opposite reasons.
- **Choropleth** — the geography is the point; distress clusters spatially (outer-suburban growth
  corridors, mining downturn towns).
- **Rankings** — the newsworthy view, and what most visitors came for.
- **Explorer + sparklines** — answers "is my region getting worse?", which a snapshot cannot.
- **Stacked timeline** — carries the headline finding (the post-2020 collapse) and the reform
  annotations that explain it.
- **Administration mix** — the debt agreement collapse is invisible in totals; only the mix shows it.
- **Matrix** — state × type reveals that debt agreements were always a Queensland-heavy instrument.
- **Histogram** — shows how skewed the rate distribution is, and click-through makes it a filter.
- **Insights** — surfaces the outliers a user would never find by scrolling.

Sequential scales use a **log or quantile-aware** ramp chosen against the actual skew (per the
chart-encoding rule) — the rate distribution is right-skewed and a linear ramp flattens it.
