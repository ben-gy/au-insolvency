// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Ben Richardson — https://benrichardson.dev
// Additional terms under AGPL-3.0 section 7(b) apply; see ADDITIONAL-TERMS.md.
import type { Dataset } from '../types';
import { num, quarterLabel } from '../format';
import { legend, stackedArea } from '../charts';
import { groupSeries, quarterTotal } from '../analysis';
import { gloss } from '../glossary';

const GROUP_COLOUR: Record<string, string> = {
  Bankruptcy: 'var(--accent-primary)',
  'Debt agreement': 'var(--business)',
  'Personal insolvency agreement': 'var(--consumer)',
};

export function renderTimeline(root: HTMLElement, data: Dataset): void {
  const { national } = data;
  const labels = national.quarters.map(quarterLabel);
  const series = national.groups.map((g) => ({
    key: g.key,
    label: g.key,
    colour: GROUP_COLOUR[g.key] ?? 'var(--text-tertiary)',
    values: groupSeries(national, g.key),
  }));

  const totals = national.quarters.map((_, i) => quarterTotal(national, i));
  const peak = Math.max(...totals);
  const peakAt = labels[totals.indexOf(peak)];
  const trough = Math.min(...totals);
  const troughAt = labels[totals.indexOf(trough)];
  const latest = totals[totals.length - 1];

  const annotations = [
    { at: labels.indexOf('Sep 2009'), text: 'GFC peak' },
    { at: labels.indexOf('Jun 2019'), text: 'Debt agreement reforms' },
    { at: labels.indexOf('Jun 2020'), text: 'COVID support' },
    { at: labels.indexOf('Jun 2023'), text: 'Cost-of-living' },
  ].filter((a) => a.at >= 0);

  root.innerHTML = `
    <div class="view-head">
      <h2>Nineteen years of going broke</h2>
      <p>Every ${gloss('personal insolvency')} in Australia by quarter, stacked by the kind of arrangement entered. The striking thing is the collapse: formal insolvency is running at roughly a third of its pre-2020 level despite sustained cost-of-living pressure.</p>
    </div>

    <div class="stat-row">
      <div class="stat"><div class="stat-label">Peak quarter</div><div class="stat-value">${num(peak)}</div><div class="stat-note">${peakAt}</div></div>
      <div class="stat"><div class="stat-label">Lowest quarter</div><div class="stat-value">${num(trough)}</div><div class="stat-note">${troughAt}</div></div>
      <div class="stat"><div class="stat-label">Latest quarter</div><div class="stat-value">${num(latest)}</div><div class="stat-note">${labels[labels.length - 1]}</div></div>
      <div class="stat"><div class="stat-label">Below peak</div><div class="stat-value">${Math.round((1 - latest / peak) * 100)}%</div><div class="stat-note">still far under 2009 levels</div></div>
    </div>

    <div class="panel">
      <h3 style="font-size:var(--font-size-base)">Personal insolvencies per quarter, by type</h3>
      <p style="color:var(--text-secondary);font-size:var(--font-size-sm);margin-bottom:var(--space-md)">
        Hover any point for the exact split. Dashed lines mark the events that bend the series.
      </p>
      <div class="scroll-x">${stackedArea(series, labels, { width: 980, height: 380, annotations })}</div>
      ${legend(series.map((s) => ({ label: s.label, colour: s.colour })))}
    </div>

    <div class="panel" style="margin-top:var(--space-lg)">
      <h3 style="font-size:var(--font-size-base)">Why the fall is not simply good news</h3>
      <p style="color:var(--text-secondary);font-size:var(--font-size-sm);margin-top:var(--space-sm)">
        Two things pushed these numbers down, and neither is households becoming more solvent. The June 2019
        ${gloss('debt agreement')} reforms capped fees and tightened eligibility, removing the instrument that had
        been absorbing much of the volume. Then pandemic-era support, higher bankruptcy thresholds and creditor
        forbearance suppressed the rest. What the series measures is entry into a <em>formal</em> process — when
        that process becomes harder or less attractive to enter, distress does not disappear from the economy,
        it disappears from the statistics.
      </p>
    </div>`;
}
