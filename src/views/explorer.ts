// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Ben Richardson — https://benrichardson.dev
// Additional terms under AGPL-3.0 section 7(b) apply; see ADDITIONAL-TERMS.md.
import type { Dataset, Region } from '../types';
import { abbr, delta, esc, num, pct, rate, severity } from '../format';
import { sparkline } from '../charts';
import { openRegion } from '../main';
import { gloss } from '../glossary';

type Col = 'name' | 'state' | 'rate' | 'total12' | 'change4y' | 'bizShare' | 'pop';

let sortCol: Col = 'rate';
let sortDesc = true;
let query = '';
let debounce: number | undefined;

export function renderExplorer(root: HTMLElement, data: Dataset, initialFilter?: string): void {
  if (initialFilter !== undefined) query = initialFilter;
  const { meta } = data;

  const shell = `
    <div class="view-head">
      <h2>Every region, searchable</h2>
      <p>All ${num(meta.counts.regions)} ${gloss('sa3', 'SA3 regions')} with their twelve-month totals, rates, four-year change and the full quarterly trend since 2007. Sort any column; search by region or state.</p>
    </div>
    <div class="controls">
      <input type="search" id="q" placeholder="Search region or state…" value="${esc(query)}" aria-label="Search regions">
      <span id="result-count" style="color:var(--text-tertiary);font-size:var(--font-size-sm)"></span>
    </div>
    <div class="panel table-scroll"><table>
      <thead><tr>
        <th class="sortable" data-col="name">Region</th>
        <th class="sortable" data-col="state">State</th>
        <th class="sortable right" data-col="rate">Rate /10k</th>
        <th class="sortable right" data-col="total12">12-month total</th>
        <th class="sortable right" data-col="change4y">4-year change</th>
        <th class="sortable right" data-col="bizShare">Business share</th>
        <th class="sortable right" data-col="pop">Adults</th>
        <th>Trend</th>
      </tr></thead>
      <tbody id="rows"></tbody>
    </table></div>
    <p style="color:var(--text-tertiary);font-size:var(--font-size-sm);margin-top:var(--space-sm)">
      A blank business share means AFSA ${gloss('suppression', 'withheld too much of that region’s split')} for the proportion to be meaningful.
      A <strong>*</strong> marks a twelve-month total where at least one quarter was withheld, so the figure is a midpoint
      estimate rather than a count — hover it for the range.
    </p>`;

  root.innerHTML = shell;

  const rowsEl = root.querySelector<HTMLElement>('#rows')!;
  const countEl = root.querySelector<HTMLElement>('#result-count')!;

  const val = (r: Region, c: Col): string | number | null => {
    switch (c) {
      case 'name': return r.name;
      case 'state': return r.state;
      case 'rate': return r.rate;
      case 'total12': return r.total12;
      case 'change4y': return r.change4y;
      case 'bizShare': return r.bizShare;
      case 'pop': return r.pop;
    }
  };

  const draw = () => {
    const q = query.trim().toLowerCase();
    const filtered = data.regions.filter(
      (r) => !q || r.name.toLowerCase().includes(q) || r.state.toLowerCase().includes(q) || abbr(r.state).toLowerCase() === q,
    );
    const sorted = [...filtered].sort((a, b) => {
      const av = val(a, sortCol);
      const bv = val(b, sortCol);
      // Nulls always sort last, whichever direction the column is going —
      // otherwise "sort by business share" leads with 200 blank rows.
      if (av === null && bv === null) return 0;
      if (av === null) return 1;
      if (bv === null) return -1;
      if (typeof av === 'string' && typeof bv === 'string') {
        return sortDesc ? bv.localeCompare(av) : av.localeCompare(bv);
      }
      return sortDesc ? (bv as number) - (av as number) : (av as number) - (bv as number);
    });

    countEl.textContent = `${sorted.length} of ${data.regions.length} regions`;
    rowsEl.innerHTML =
      sorted
        .map(
          (r) => `<tr class="clickable" data-code="${esc(r.code)}" tabindex="0">
        <td class="region-name">${esc(r.name)}</td>
        <td><span class="state-pill">${esc(abbr(r.state))}</span></td>
        <td class="right num" style="color:${severity(r.rate, meta.medians.rate)};font-weight:600">${rate(r.rate)}</td>
        <td class="right num"${
          r.exact
            ? ''
            : ` data-tip="${esc(`${r.withheld12} of 4 quarters withheld — true figure is between ${r.lo12} and ${r.hi12}`)}"`
        }>${num(r.total12)}${r.exact ? '' : '<span style="color:var(--text-muted)" aria-label="estimated">*</span>'}</td>
        <td class="right num ${(r.change4y ?? 0) > 0 ? 'pos' : 'neg'}">${delta(r.change4y)}</td>
        <td class="right num" style="color:var(--text-secondary)">${r.bizShare === null ? '<span style="color:var(--text-muted)">—</span>' : pct(r.bizShare, 0)}</td>
        <td class="right num" style="color:var(--text-secondary)">${r.pop ? num(r.pop) : '—'}</td>
        <td>${sparkline(r.series, 96, 22, severity(r.rate, meta.medians.rate))}</td>
      </tr>`,
        )
        .join('') || '<tr><td colspan="8" class="empty-state">No regions match that search.</td></tr>';

    rowsEl.querySelectorAll<HTMLTableRowElement>('tr[data-code]').forEach((tr) => {
      tr.addEventListener('click', () => openRegion(tr.dataset.code!));
      tr.addEventListener('keydown', (e) => { if (e.key === 'Enter') openRegion(tr.dataset.code!); });
    });

    root.querySelectorAll<HTMLElement>('th[data-col]').forEach((th) => {
      const active = th.dataset.col === sortCol;
      th.style.color = active ? 'var(--accent-primary)' : '';
      th.setAttribute('aria-sort', active ? (sortDesc ? 'descending' : 'ascending') : 'none');
    });
  };

  root.querySelector<HTMLInputElement>('#q')!.addEventListener('input', (e) => {
    const v = (e.target as HTMLInputElement).value;
    window.clearTimeout(debounce);
    debounce = window.setTimeout(() => { query = v; draw(); }, 300);
  });

  root.querySelectorAll<HTMLElement>('th[data-col]').forEach((th) => {
    th.addEventListener('click', () => {
      const col = th.dataset.col as Col;
      if (col === sortCol) sortDesc = !sortDesc;
      else { sortCol = col; sortDesc = col !== 'name' && col !== 'state'; }
      draw();
    });
  });

  draw();
}
