import type { Dataset } from '../types';
import { abbr, esc, num, pct, quarterLabel, rate, tip } from '../format';
import { horizontalBars, legend, stackedArea } from '../charts';
import { openRegion } from '../main';
import { gloss } from '../glossary';

export function renderSplit(root: HTMLElement, data: Dataset): void {
  const { national, meta } = data;
  const labels = national.quarters.map(quarterLabel);
  const last = national.split.length - 1;

  const sumFor = (i: number, kind: 'business' | 'consumer') => {
    const cell = national.split[i] ?? {};
    let s = 0;
    for (const k in cell) if (k.startsWith(`${kind}|`)) s += cell[k];
    return s;
  };

  const business = labels.map((_, i) => sumFor(i, 'business'));
  const consumer = labels.map((_, i) => sumFor(i, 'consumer'));
  const bizShare = business.map((b, i) => (b + consumer[i] ? (b / (b + consumer[i])) * 100 : 0));

  // By state, latest quarter — reliable at this level.
  const byState = national.states
    .filter((s) => s !== 'Other')
    .map((s) => {
      const b = national.split[last]?.[`business|${s}`] ?? 0;
      const c = national.split[last]?.[`consumer|${s}`] ?? 0;
      return { state: s, business: b, consumer: c, total: b + c, share: b + c ? b / (b + c) : 0 };
    })
    .sort((a, b) => b.share - a.share);

  // Regions where the split survived suppression.
  const withSplit = data.regions
    .filter((r) => r.bizShare !== null && r.total12 >= 20)
    .sort((a, b) => (b.bizShare ?? 0) - (a.bizShare ?? 0));

  const nationalShare = business[last] + consumer[last] ? business[last] / (business[last] + consumer[last]) : 0;

  root.innerHTML = `
    <div class="view-head">
      <h2>A failed business, or a failed household budget?</h2>
      <p>AFSA flags each insolvency as ${gloss('business related')} or not. The distinction matters — one is a business collapsing and taking its owner with it, the other is household finances giving way — but it is also the part of this dataset most heavily withheld.</p>
    </div>

    <div class="stat-row">
      <div class="stat"><div class="stat-label">Business related</div><div class="stat-value" style="color:var(--business)">${pct(nationalShare, 0)}</div><div class="stat-note">of insolvencies, latest quarter</div></div>
      <div class="stat"><div class="stat-label">Consumer</div><div class="stat-value" style="color:var(--consumer)">${pct(1 - nationalShare, 0)}</div><div class="stat-note">no business involved</div></div>
      <div class="stat"><div class="stat-label">Split published</div><div class="stat-value">${pct(meta.counts.splitCoverageNational, 0)}</div><div class="stat-note">of insolvencies nationally</div></div>
      <div class="stat"><div class="stat-label">Regions usable</div><div class="stat-value">${num(meta.counts.splitPublishedRegions)}</div><div class="stat-note">of ${num(meta.counts.regions)} SA3s</div></div>
    </div>

    <div class="panel" style="border-left:3px solid var(--status-warn)">
      <h3 style="font-size:var(--font-size-base)">What this view cannot show you</h3>
      <p style="color:var(--text-secondary);font-size:var(--font-size-sm);margin-top:var(--space-sm)">
        AFSA applies ${gloss('suppression', 'complementary suppression')} to this split: whenever one side of it would
        be small enough to identify someone, <em>both</em> sides are withheld, so the missing number cannot be
        recovered by subtracting from the published total. Nationally that hides
        ${pct(1 - meta.counts.splitCoverageNational, 0)} of cases, and because the suppression bites hardest in small
        regions it hides far more than that in most of them. Only
        ${num(meta.counts.splitPublishedRegions)} of ${num(meta.counts.regions)} regions have at least
        ${pct(meta.minSplitCoverage, 0)} of their cases published, and this site states a business share only for
        those. A suppressed cell is not a zero — genuine zeros are published as zeros.
      </p>
    </div>

    <div class="panel" style="margin-top:var(--space-lg)">
      <h3 style="font-size:var(--font-size-base)">The business share over time</h3>
      <p style="color:var(--text-secondary);font-size:var(--font-size-sm);margin-bottom:var(--space-md)">
        Nationally the split is well published, so the trend is sound. Business-related insolvency is a minority of
        the total throughout — personal insolvency is overwhelmingly a household-debt phenomenon.
      </p>
      <div class="scroll-x">${stackedArea(
        [
          { key: 'consumer', label: 'Consumer', colour: 'var(--consumer)', values: consumer },
          { key: 'business', label: 'Business related', colour: 'var(--business)', values: business },
        ],
        labels,
        { width: 980, height: 320 },
      )}</div>
      ${legend([
        { label: 'Consumer', colour: 'var(--consumer)' },
        { label: 'Business related', colour: 'var(--business)' },
      ])}
      <h4 style="font-size:var(--font-size-sm);margin-top:var(--space-lg);color:var(--text-secondary)">Business-related share (%)</h4>
      <div class="scroll-x">${stackedArea(
        [{ key: 'share', label: 'Business-related share (%)', colour: 'var(--business)', values: bizShare }],
        labels,
        { width: 980, height: 200 },
      )}</div>
    </div>

    <div class="panel" style="margin-top:var(--space-lg)">
      <h3 style="font-size:var(--font-size-base)">By state, latest quarter</h3>
      <p style="color:var(--text-secondary);font-size:var(--font-size-sm);margin-bottom:var(--space-md)">
        State cells are large enough that suppression barely bites, so this is the most reliable cut of the split.
      </p>
      <div class="scroll-x">${horizontalBars(
        byState.map((s) => ({
          label: abbr(s.state),
          value: Math.round(s.share * 1000) / 10,
          colour: 'var(--business)',
          tipText: `${s.state}\nBusiness related: ${s.business.toLocaleString('en-AU')} (${(s.share * 100).toFixed(1)}%)\nConsumer: ${s.consumer.toLocaleString('en-AU')}`,
        })),
        { width: 820, rowHeight: 28, labelWidth: 90, unit: '%' },
      )}</div>
    </div>

    <div class="panel" style="margin-top:var(--space-lg)">
      <h3 style="font-size:var(--font-size-base)">Regions where the split is published</h3>
      <p style="color:var(--text-secondary);font-size:var(--font-size-sm);margin-bottom:var(--space-md)">
        The ${num(withSplit.length)} regions with enough published detail, ranked by business-related share. Every
        other region is absent because the answer is genuinely withheld, not because it is zero. Click any row to
        open that region.
      </p>
      <div class="table-scroll"><table>
        <thead><tr>
          <th>Region</th><th>State</th>
          <th class="right">Business share</th><th class="right">Business</th>
          <th class="right">12-month total</th><th class="right">Rate /10k</th><th class="right">Split published</th>
        </tr></thead>
        <tbody>${withSplit
          .map(
            (r) => `<tr class="clickable" data-code="${esc(r.code)}" tabindex="0">
            <td class="region-name">${esc(r.name)}</td>
            <td><span class="state-pill">${esc(abbr(r.state))}</span></td>
            <td class="right num" style="color:var(--business);font-weight:600"
              data-tip="${tip(`${r.name}: ${pct(r.bizShare, 0)} of insolvencies were business related`)}">${pct(r.bizShare, 0)}</td>
            <td class="right num">${num(r.business12)}</td>
            <td class="right num">${num(r.total12)}</td>
            <td class="right num">${rate(r.rate)}</td>
            <td class="right num" style="color:var(--text-tertiary)">${pct(r.splitCoverage, 0)}</td>
          </tr>`,
          )
          .join('')}</tbody>
      </table></div>
    </div>`;

  root.querySelectorAll<HTMLTableRowElement>('tr[data-code]').forEach((tr) => {
    tr.addEventListener('click', () => openRegion(tr.dataset.code!));
    tr.addEventListener('keydown', (e) => { if (e.key === 'Enter') openRegion(tr.dataset.code!); });
  });
}
