import type { Dataset, Region } from '../types';
import { abbr, esc, num, rate, tip } from '../format';
import { histogram } from '../utils/histogram';
import { openRegion } from '../main';
import { navigate } from '../main';
import { gloss } from '../glossary';

let selectedBin: number | null = null;

export function renderDistribution(root: HTMLElement, data: Dataset): void {
  const { meta } = data;
  const rated = data.regions.filter((r) => r.rate !== null);
  const bins = histogram(rated.map((r) => r.rate!), 16);

  const W = 900;
  const H = 340;
  const padL = 48;
  const padR = 16;
  const padT = 16;
  const padB = 48;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const maxCount = Math.max(...bins.map((b) => b.count), 1);
  const binW = plotW / bins.length;

  const draw = () => {
    const bars = bins
      .map((b, i) => {
        const h = (b.count / maxCount) * plotH;
        const selected = selectedBin === i;
        return `<rect class="bar" x="${(padL + i * binW + 1).toFixed(1)}" y="${(padT + plotH - h).toFixed(1)}"
          width="${(binW - 2).toFixed(1)}" height="${h.toFixed(1)}" rx="2"
          fill="${selected ? 'var(--accent-primary)' : 'var(--sev-3)'}"
          style="cursor:pointer" data-bin="${i}"
          data-tip="${tip(`${b.count} region${b.count === 1 ? '' : 's'} at ${b.lo.toFixed(1)}–${b.hi.toFixed(1)} per 10,000 adults\nClick to list them`)}"
          aria-label="${b.count} regions between ${b.lo.toFixed(1)} and ${b.hi.toFixed(1)}"/>`;
      })
      .join('');

    const xLabels = bins
      .map((b, i) =>
        i % 2 === 0
          ? `<text class="axis-text" x="${(padL + i * binW + binW / 2).toFixed(1)}" y="${padT + plotH + 16}" text-anchor="middle">${b.lo.toFixed(0)}</text>`
          : '',
      )
      .join('');

    const medX = padL + (meta.medians.rate / (bins[bins.length - 1].hi || 1)) * plotW;
    const medLine = `<line x1="${medX.toFixed(1)}" y1="${padT}" x2="${medX.toFixed(1)}" y2="${padT + plotH}"
        stroke="var(--text-primary)" stroke-width="1.2" stroke-dasharray="4 3" opacity=".65"/>
      <text class="axis-text" x="${(medX + 5).toFixed(1)}" y="${padT + 12}" style="fill:var(--text-secondary)">median ${rate(meta.medians.rate)}</text>`;

    const yTicks = [0, Math.round(maxCount / 2), maxCount]
      .map(
        (t) =>
          `<line class="grid-line" x1="${padL}" y1="${padT + plotH - (t / maxCount) * plotH}" x2="${W - padR}" y2="${padT + plotH - (t / maxCount) * plotH}"/>
           <text class="axis-text" x="${padL - 6}" y="${padT + plotH - (t / maxCount) * plotH}" text-anchor="end" dominant-baseline="middle">${t}</text>`,
      )
      .join('');

    // Captured to a local so it narrows inside the closures below.
    const bin = selectedBin === null ? null : bins[selectedBin];
    const listed: Region[] =
      bin === null
        ? []
        : rated
            // The top bin is closed on the right so the highest region is listed
            // rather than falling through every bin.
            .filter((r) => r.rate! >= bin.lo && (r.rate! < bin.hi || bin === bins[bins.length - 1]))
            .sort((a, b) => (b.rate ?? 0) - (a.rate ?? 0));

    root.querySelector<HTMLElement>('#hist')!.innerHTML = `
      <svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Distribution of insolvency rates across regions">
        ${yTicks}${bars}${medLine}
        <line class="axis-line" x1="${padL}" y1="${padT + plotH}" x2="${W - padR}" y2="${padT + plotH}"/>
        ${xLabels}
        <text class="axis-title" x="${padL + plotW / 2}" y="${H - 8}" text-anchor="middle">Insolvencies per 10,000 adults, last 12 months</text>
        <text class="axis-title" transform="translate(14 ${padT + plotH / 2}) rotate(-90)" text-anchor="middle">Regions</text>
      </svg>`;

    root.querySelector<HTMLElement>('#bin-list')!.innerHTML =
      selectedBin === null
        ? `<p style="color:var(--text-tertiary);font-size:var(--font-size-sm)">Click a bar to list the regions in that band.</p>`
        : `<h3 style="font-size:var(--font-size-base);margin-bottom:var(--space-sm)">
             ${listed.length} region${listed.length === 1 ? '' : 's'} at ${bins[selectedBin].lo.toFixed(1)}–${bins[selectedBin].hi.toFixed(1)} per 10,000 adults
             <button id="clear-bin" style="margin-left:8px;background:none;border:0;color:var(--accent-primary);cursor:pointer;font:inherit;font-size:var(--font-size-sm);text-decoration:underline">clear</button>
           </h3>
           <div class="table-scroll"><table>
             <thead><tr><th>Region</th><th>State</th><th class="right">Rate /10k</th><th class="right">12-month total</th></tr></thead>
             <tbody>${listed
               .map(
                 (r) => `<tr class="clickable" data-code="${esc(r.code)}" tabindex="0">
                   <td class="region-name">${esc(r.name)}</td>
                   <td><span class="state-pill">${esc(abbr(r.state))}</span></td>
                   <td class="right num">${rate(r.rate)}</td>
                   <td class="right num">${num(r.total12)}</td></tr>`,
               )
               .join('')}</tbody>
           </table></div>
           <p style="margin-top:var(--space-sm)"><button id="to-explorer" style="background:none;border:0;color:var(--accent-primary);cursor:pointer;font:inherit;font-size:var(--font-size-sm);text-decoration:underline">Open these in the Explorer →</button></p>`;

    root.querySelectorAll<SVGRectElement>('[data-bin]').forEach((b) =>
      b.addEventListener('click', () => {
        const i = Number(b.dataset.bin);
        selectedBin = selectedBin === i ? null : i;
        draw();
      }),
    );
    root.querySelector('#clear-bin')?.addEventListener('click', () => { selectedBin = null; draw(); });
    root.querySelector('#to-explorer')?.addEventListener('click', () => navigate({ view: 'explorer' }));
    root.querySelectorAll<HTMLTableRowElement>('tr[data-code]').forEach((tr) => {
      tr.addEventListener('click', () => openRegion(tr.dataset.code!));
      tr.addEventListener('keydown', (e) => { if (e.key === 'Enter') openRegion(tr.dataset.code!); });
    });
  };

  root.innerHTML = `
    <div class="view-head">
      <h2>How unequal is it?</h2>
      <p>The spread of ${gloss('per 10,000 adults', 'insolvency rates')} across all ${num(rated.length)} ranked regions. The distribution is strongly right-skewed — most regions cluster low, and a long tail carries the burden. Click any bar to list the regions inside it.</p>
    </div>
    <div class="panel"><div class="chart-wrap" id="hist"></div></div>
    <div class="panel" style="margin-top:var(--space-lg)" id="bin-list"></div>`;

  draw();
}
