// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Ben Richardson — https://benrichardson.dev
// Additional terms under AGPL-3.0 section 7(b) apply; see ADDITIONAL-TERMS.md.
import type { Dataset, Region } from './types';
import { delta, esc, num, pct, quarterLabel, rate, severity, tip } from './format';
import { stackedArea } from './charts';
import { gloss } from './glossary';

export function renderDrawer(el: HTMLElement, region: Region, data: Dataset): void {
  const { meta } = data;
  const rated = data.regions.filter((r) => r.rate !== null).sort((a, b) => (b.rate ?? 0) - (a.rate ?? 0));
  const rank = rated.findIndex((r) => r.code === region.code) + 1;
  const vsMedian = region.rate !== null ? region.rate / meta.medians.rate : null;

  // Quarterly rolling series -> stacked area of one band (the region's own
  // trend), reusing the same chart the national views use so the shapes read
  // consistently.
  const values = region.series.map((v) => v ?? 0);
  const firstReal = region.series.findIndex((v) => v !== null);
  const labels = meta.quarters.map(quarterLabel);

  el.innerHTML = `
    <button class="icon-btn drawer-close" aria-label="Close region detail">✕</button>
    <h2>${esc(region.name)}</h2>
    <p class="sub">${esc(region.state)} · ${gloss('sa3', 'SA3')} ${esc(region.code)}${
      region.pop ? ` · ${num(region.pop)} adults` : ''
    }</p>

    <div class="stat-row" style="grid-template-columns:repeat(auto-fit,minmax(min(140px,100%),1fr))">
      <div class="stat">
        <div class="stat-label">Rate per 10,000</div>
        <div class="stat-value" style="color:${severity(region.rate, meta.medians.rate)}">${rate(region.rate)}</div>
        <div class="stat-note">${
          vsMedian === null
            ? 'population below the reporting floor'
            : `${vsMedian.toFixed(1)}× the national median`
        }</div>
      </div>
      <div class="stat">
        <div class="stat-label">Last 12 months</div>
        <div class="stat-value">${region.exact ? num(region.total12) : `${num(region.lo12)}–${num(region.hi12)}`}</div>
        <div class="stat-note">${
          region.exact
            ? `${delta(region.change)} on the year before`
            : `${region.withheld12} of 4 quarters withheld`
        }</div>
      </div>
      <div class="stat">
        <div class="stat-label">National rank</div>
        <div class="stat-value">${rank > 0 ? `${rank}` : '—'}</div>
        <div class="stat-note">${rank > 0 ? `of ${rated.length} ranked regions` : 'not ranked'}</div>
      </div>
      <div class="stat">
        <div class="stat-label">Four-year change</div>
        <div class="stat-value ${(region.change4y ?? 0) > 0 ? 'pos' : 'neg'}">${delta(region.change4y)}</div>
        <div class="stat-note">median ${delta(meta.medians.change4y)}</div>
      </div>
    </div>

    <h3 style="font-size:var(--font-size-base);margin-bottom:var(--space-xs)">Insolvencies over time</h3>
    <p style="color:var(--text-secondary);font-size:var(--font-size-sm);margin-bottom:var(--space-sm)">
      Rolling twelve-month total, so seasonal spikes do not read as trends. Hover for any quarter.
    </p>
    <div class="chart-wrap">${stackedArea(
      [{ key: 'total', label: 'Insolvencies (12-month rolling)', colour: 'var(--accent-primary)', values }],
      labels,
      { width: 520, height: 200, annotations: annotationsFor(labels) },
    )}</div>
    ${
      firstReal > 0
        ? `<p style="color:var(--text-tertiary);font-size:var(--font-size-xs);margin-top:var(--space-xs)">The first ${firstReal} quarters are blank because the twelve-month window has not yet filled.</p>`
        : ''
    }

    <h3 style="font-size:var(--font-size-base);margin:var(--space-lg) 0 var(--space-sm)">Breakdown</h3>
    <dl class="kv">
      <dt>Insolvencies, last 12 months</dt>
      <dd>${region.exact ? num(region.total12) : `${num(region.lo12)}–${num(region.hi12)}`}</dd>
      ${
        region.exact
          ? ''
          : `<dt>Published in that window</dt><dd>${num(region.published12)} + ${region.withheld12} withheld quarter${region.withheld12 === 1 ? '' : 's'}</dd>`
      }
      <dt>Insolvencies, 12 months before</dt><dd>${num(region.prev12)}</dd>
      <dt>Adult residents (${esc(String(meta.erpYear))})</dt><dd>${region.pop ? num(region.pop) : '—'}</dd>
      <dt>Rate per 10,000 adults</dt><dd>${rate(region.rate)}</dd>
      <dt>National median rate</dt><dd>${rate(meta.medians.rate)}</dd>
      <dt><span data-tip="${tip('Share flagged by AFSA as arising from a business the person ran. Shown only where enough of the split was published.')}">Business related</span></dt>
      <dd>${
        region.bizShare === null
          ? '<span style="color:var(--text-muted)">withheld</span>'
          : `${pct(region.bizShare, 0)}${region.business12 !== null ? ` (${num(region.business12)})` : ''}`
      }</dd>
      <dt>Split published for</dt><dd>${pct(region.splitCoverage, 0)} of cases</dd>
    </dl>

    ${
      region.bizShare === null
        ? `<p style="color:var(--text-tertiary);font-size:var(--font-size-sm)">AFSA ${gloss(
            'suppression',
            'withheld the business/consumer split',
          )} for most of this region's insolvencies, so no reliable share can be stated.</p>`
        : ''
    }
    ${
      region.exact
        ? ''
        : `<p style="color:var(--text-tertiary);font-size:var(--font-size-sm);margin-top:var(--space-sm)">
             ${region.withheld12} of the last four quarters were ${gloss('suppression', 'withheld')} as too small to publish.
             A withheld quarter is one or two cases — never none, since genuine zeros are published — so the true
             twelve-month figure lies between ${num(region.lo12)} and ${num(region.hi12)}. The rate and rank above use the midpoint.
           </p>`
    }
  `;
}

/** Mark the two events that actually bend these series. */
function annotationsFor(labels: string[]): { at: number; text: string }[] {
  const out: { at: number; text: string }[] = [];
  const jun19 = labels.indexOf('Jun 2019');
  const jun20 = labels.indexOf('Jun 2020');
  if (jun19 >= 0) out.push({ at: jun19, text: 'DA reform' });
  if (jun20 >= 0) out.push({ at: jun20, text: 'COVID' });
  return out;
}
