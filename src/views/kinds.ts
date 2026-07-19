import type { Dataset } from '../types';
import { abbr, esc, num, pct, quarterLabel, tip } from '../format';
import { horizontalBars, legend, stackedArea } from '../charts';
import { groupSeries, typeTotal } from '../analysis';
import { gloss } from '../glossary';

const GROUP_COLOUR: Record<string, string> = {
  Bankruptcy: 'var(--accent-primary)',
  'Debt agreement': 'var(--business)',
  'Personal insolvency agreement': 'var(--consumer)',
};

export function renderKinds(root: HTMLElement, data: Dataset): void {
  const { national } = data;
  const labels = national.quarters.map(quarterLabel);
  const last = national.quarters.length - 1;

  // Composition over time, as shares — the level chart hides the mix shift.
  const groups = national.groups.map((g) => ({
    key: g.key,
    values: groupSeries(national, g.key),
  }));
  const totals = labels.map((_, i) => groups.reduce((a, g) => a + g.values[i], 0));
  const shareSeries = groups.map((g) => ({
    key: g.key,
    label: g.key,
    colour: GROUP_COLOUR[g.key] ?? 'var(--text-tertiary)',
    values: g.values.map((v, i) => (totals[i] ? (v / totals[i]) * 100 : 0)),
  }));

  // Voluntary vs creditor-forced bankruptcy.
  const petitions = national.quarters.map((_, i) => typeTotal(national, i, "Debtor's petition"));
  const orders = national.quarters.map((_, i) => typeTotal(national, i, 'Sequestration order'));
  const forcedShare = petitions.map((p, i) => (p + orders[i] ? (orders[i] / (p + orders[i])) * 100 : 0));

  // State x type matrix for the latest quarter.
  const states = national.states.filter((s) => s !== 'Other');
  const matrix = states.map((s) => {
    const cells = national.groups.map((g) => {
      const v = g.types.reduce((a, t) => a + (national.cells[last][`${t}|${s}`] ?? 0), 0);
      return { key: g.key, value: v };
    });
    const tot = cells.reduce((a, c) => a + c.value, 0);
    return { state: s, cells, total: tot };
  });

  const latestByType = national.groups
    .map((g) => ({
      label: g.key,
      value: g.types.reduce((a, t) => a + typeTotal(national, last, t), 0),
      colour: GROUP_COLOUR[g.key],
    }))
    .sort((a, b) => b.value - a.value);

  root.innerHTML = `
    <div class="view-head">
      <h2>Three different ways to be insolvent</h2>
      <p>${gloss('bankruptcy', 'Bankruptcy')}, a ${gloss('debt agreement')} and a ${gloss('personal insolvency agreement')} are very different arrangements with very different consequences. The mix between them has shifted more than the total has, and that shift is mostly invisible in a headline number.</p>
    </div>

    <div class="panel">
      <h3 style="font-size:var(--font-size-base)">Latest quarter, by type</h3>
      <p style="color:var(--text-secondary);font-size:var(--font-size-sm);margin-bottom:var(--space-md)">${esc(labels[last])}</p>
      <div class="scroll-x">${horizontalBars(
        latestByType.map((d) => ({
          label: d.label,
          value: d.value,
          colour: d.colour,
          tipText: `${d.label}: ${d.value.toLocaleString('en-AU')} in ${labels[last]}`,
        })),
        { width: 820, rowHeight: 34, labelWidth: 230 },
      )}</div>
    </div>

    <div class="panel" style="margin-top:var(--space-lg)">
      <h3 style="font-size:var(--font-size-base)">The mix, as a share of all insolvencies</h3>
      <p style="color:var(--text-secondary);font-size:var(--font-size-sm);margin-bottom:var(--space-md)">
        Debt agreements were nearly half of all personal insolvencies before the June 2019 reforms capped fees and
        tightened eligibility. Bankruptcy absorbed the difference.
      </p>
      <div class="scroll-x">${stackedArea(shareSeries, labels, {
        width: 980,
        height: 320,
        annotations: [{ at: labels.indexOf('Jun 2019'), text: 'DA reforms' }].filter((a) => a.at >= 0),
      })}</div>
      ${legend(shareSeries.map((s) => ({ label: s.label, colour: s.colour })))}
    </div>

    <div class="panel" style="margin-top:var(--space-lg)">
      <h3 style="font-size:var(--font-size-base)">Who starts it — the debtor, or a creditor?</h3>
      <p style="color:var(--text-secondary);font-size:var(--font-size-sm);margin-bottom:var(--space-md)">
        Most people enter bankruptcy by filing themselves (a ${gloss("debtor's petition")}). The rest are forced
        by a creditor going to court (a ${gloss('sequestration order')}). The forced share is a rough gauge of how
        hard creditors are pushing.
      </p>
      <div class="scroll-x">${stackedArea(
        [{ key: 'forced', label: 'Creditor-forced share of bankruptcies (%)', colour: 'var(--sev-4)', values: forcedShare }],
        labels,
        { width: 980, height: 240 },
      )}</div>
    </div>

    <div class="panel" style="margin-top:var(--space-lg)">
      <h3 style="font-size:var(--font-size-base)">State by state, latest quarter</h3>
      <p style="color:var(--text-secondary);font-size:var(--font-size-sm);margin-bottom:var(--space-md)">
        Share of each state's insolvencies by type. Debt agreements have always been used far more heavily in some
        states than others — hover any cell for the count.
      </p>
      <div class="table-scroll"><table>
        <thead><tr><th>State</th>${national.groups.map((g) => `<th class="right">${esc(g.key)}</th>`).join('')}<th class="right">Total</th></tr></thead>
        <tbody>${matrix
          .map(
            (row) => `<tr>
              <td class="region-name">${esc(abbr(row.state))}</td>
              ${row.cells
                .map((c) => {
                  const share = row.total ? c.value / row.total : 0;
                  return `<td class="right num" style="background:${shade(share, GROUP_COLOUR[c.key])}"
                    data-tip="${tip(`${row.state} — ${c.key}: ${c.value.toLocaleString('en-AU')} (${(share * 100).toFixed(0)}% of that state's insolvencies)`)}">${pct(share, 0)}</td>`;
                })
                .join('')}
              <td class="right num" style="color:var(--text-secondary)">${num(row.total)}</td>
            </tr>`,
          )
          .join('')}</tbody>
      </table></div>
    </div>`;
}

/** Tint a cell by share, using the column's own colour so the matrix stays legible. */
function shade(share: number, colour: string): string {
  const a = Math.max(0, Math.min(0.55, share * 0.75));
  return `color-mix(in srgb, ${colour} ${(a * 100).toFixed(0)}%, transparent)`;
}
