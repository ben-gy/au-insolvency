import type { Dataset, Region } from '../types';
import { abbr, delta, esc, num, rate, severity, tip } from '../format';
import { sparkline } from '../charts';
import { openRegion } from '../main';
import { gloss } from '../glossary';

type Metric = 'rate' | 'total12' | 'change4y';

const METRICS: { id: Metric; label: string; help: string }[] = [
  { id: 'rate', label: 'Rate per 10,000 adults', help: 'Insolvencies over the last twelve months per 10,000 residents aged 15+. The fair comparison between regions of different sizes.' },
  { id: 'total12', label: 'Total insolvencies', help: 'Raw count over the last twelve months. Largely tracks population size.' },
  { id: 'change4y', label: 'Four-year change', help: 'Change in the twelve-month total against the same window four years earlier.' },
];

let metric: Metric = 'rate';
let stateFilter = 'all';

export function renderRankings(root: HTMLElement, data: Dataset): void {
  const { meta } = data;

  const draw = () => {
    const pool = data.regions.filter((r) => {
      if (stateFilter !== 'all' && r.state !== stateFilter) return false;
      if (metric === 'rate') return r.rate !== null;
      if (metric === 'change4y') return r.change4y !== null && r.total12 >= 25;
      return true;
    });
    const value = (r: Region): number =>
      metric === 'rate' ? (r.rate ?? 0) : metric === 'total12' ? r.total12 : (r.change4y ?? 0);
    const ranked = [...pool].sort((a, b) => value(b) - value(a)).slice(0, 60);

    const body = ranked
      .map((r, i) => {
        const v = value(r);
        const cell =
          metric === 'change4y'
            ? `<span class="num ${v > 0 ? 'pos' : 'neg'}">${delta(v)}</span>`
            : metric === 'rate'
              ? `<span class="num" style="color:${severity(r.rate, meta.medians.rate)};font-weight:600">${rate(r.rate)}</span>`
              : `<span class="num">${num(r.total12)}</span>`;
        return `<tr class="clickable" data-code="${esc(r.code)}" tabindex="0">
          <td class="rank">${i + 1}</td>
          <td class="region-name">${esc(r.name)}</td>
          <td><span class="state-pill">${esc(abbr(r.state))}</span></td>
          <td class="right">${cell}</td>
          <td class="right num" style="color:var(--text-secondary)">${num(r.total12)}</td>
          <td class="right num" style="color:var(--text-secondary)">${r.pop ? num(r.pop) : '—'}</td>
          <td>${sparkline(r.series, 96, 22, severity(r.rate, meta.medians.rate))}</td>
        </tr>`;
      })
      .join('');

    const metricHelp = METRICS.find((m) => m.id === metric)!.help;

    root.innerHTML = `
      <div class="view-head">
        <h2>Which regions have the most personal insolvency?</h2>
        <p>Every ${gloss('sa3', 'SA3 region')} ranked over the ${gloss('trailing four quarters')}. Rates are ${gloss('per 10,000 adults')}, so a small town with a serious problem is not buried beneath a big city with a mild one. Click any row for that region's full history.</p>
      </div>

      <div class="stat-row">
        <div class="stat"><div class="stat-label">Insolvencies, last 12 months</div><div class="stat-value">${num(meta.counts.nationalTotal12)}</div><div class="stat-note">across ${num(meta.counts.regions)} regions</div></div>
        <div class="stat"><div class="stat-label">National median rate</div><div class="stat-value">${rate(meta.medians.rate)}</div><div class="stat-note">per 10,000 adults</div></div>
        <div class="stat"><div class="stat-label">Highest region</div><div class="stat-value">${rate(ranked[0]?.rate ?? null)}</div><div class="stat-note">${esc(ranked[0]?.name ?? '—')}</div></div>
        <div class="stat"><div class="stat-label">Median 4-year change</div><div class="stat-value">${delta(meta.medians.change4y)}</div><div class="stat-note">since the post-2020 low</div></div>
      </div>

      <div class="controls">
        <div class="seg" role="group" aria-label="Rank by">
          ${METRICS.map((m) => `<button data-metric="${m.id}" aria-pressed="${m.id === metric}" data-tip="${tip(m.help)}">${m.label}</button>`).join('')}
        </div>
        <select id="state-filter" aria-label="Filter by state">
          <option value="all">All states &amp; territories</option>
          ${[...new Set(data.regions.map((r) => r.state))].sort().map((s) => `<option value="${esc(s)}"${s === stateFilter ? ' selected' : ''}>${esc(s)}</option>`).join('')}
        </select>
        <span style="color:var(--text-tertiary);font-size:var(--font-size-sm)">${metricHelp}</span>
      </div>

      <div class="panel table-scroll">
        <table>
          <thead><tr>
            <th>#</th><th>Region</th><th>State</th>
            <th class="right">${esc(METRICS.find((m) => m.id === metric)!.label)}</th>
            <th class="right">12-month total</th><th class="right">Adults</th><th>Trend since 2007</th>
          </tr></thead>
          <tbody>${body || '<tr><td colspan="7" class="empty-state">No regions match.</td></tr>'}</tbody>
        </table>
      </div>
      ${metric === 'change4y' ? '<p style="color:var(--text-tertiary);font-size:var(--font-size-sm);margin-top:var(--space-sm)">Regions with fewer than 25 insolvencies in the last twelve months are excluded from the change ranking — percentage change on a handful of cases is noise.</p>' : ''}
    `;

    root.querySelectorAll<HTMLButtonElement>('[data-metric]').forEach((b) =>
      b.addEventListener('click', () => { metric = b.dataset.metric as Metric; draw(); }),
    );
    root.querySelector<HTMLSelectElement>('#state-filter')!.addEventListener('change', (e) => {
      stateFilter = (e.target as HTMLSelectElement).value;
      draw();
    });
    root.querySelectorAll<HTMLTableRowElement>('tr[data-code]').forEach((tr) => {
      tr.addEventListener('click', () => openRegion(tr.dataset.code!));
      tr.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') openRegion(tr.dataset.code!);
      });
    });
  };

  draw();
}
