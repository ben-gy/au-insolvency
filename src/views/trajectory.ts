import type { Dataset } from '../types';
import { abbr, delta, esc, num, rate, tip } from '../format';
import { attachSvgZoom } from '../utils/svgZoom';
import { QUADRANT_LABEL, quadrant } from '../analysis';
import { openRegion } from '../main';
import { gloss } from '../glossary';

const QUAD_COLOUR: Record<string, string> = {
  entrenched: 'var(--sev-5)',
  emerging: 'var(--status-warn)',
  improving: 'var(--consumer)',
  stable: '#8aa0bf',
};

let hidden = new Set<string>();

export function renderTrajectory(root: HTMLElement, data: Dataset): void {
  const { meta } = data;
  const medRate = meta.medians.rate;
  const medChange = meta.medians.change4y;

  const pool = data.regions.filter(
    (r) => r.rate !== null && r.change4y !== null && r.total12 >= 15,
  );

  const W = 900;
  const H = 560;
  const padL = 60;
  const padR = 20;
  const padT = 20;
  const padB = 52;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  const rates = pool.map((r) => r.rate!);
  const changes = pool.map((r) => r.change4y!);
  const xMax = Math.max(...rates) * 1.05;
  // Clamp the y-domain: a couple of tiny regions post +400% and would squash
  // everything else into a band ten pixels tall.
  const yLo = Math.max(-1, Math.min(...changes));
  const yHi = Math.min(2.5, Math.max(...changes));

  const x = (v: number) => padL + (v / xMax) * plotW;
  const y = (v: number) => padT + plotH - ((Math.min(yHi, Math.max(yLo, v)) - yLo) / (yHi - yLo)) * plotH;

  const draw = () => {
    const visible = pool.filter((r) => !hidden.has(quadrant(r, medRate, medChange) ?? ''));

    const xTicks = [0, 4, 8, 12, 16].filter((t) => t <= xMax);
    const yTicks = [-0.5, 0, 0.5, 1, 1.5, 2].filter((t) => t >= yLo && t <= yHi);

    const grid = `
      ${xTicks.map((t) => `<line class="grid-line" x1="${x(t)}" y1="${padT}" x2="${x(t)}" y2="${padT + plotH}"/>
        <text class="axis-text" x="${x(t)}" y="${padT + plotH + 16}" text-anchor="middle">${t}</text>`).join('')}
      ${yTicks.map((t) => `<line class="grid-line" x1="${padL}" y1="${y(t)}" x2="${W - padR}" y2="${y(t)}"/>
        <text class="axis-text" x="${padL - 8}" y="${y(t)}" text-anchor="end" dominant-baseline="middle">${delta(t)}</text>`).join('')}`;

    // The crosshairs are the whole point: they turn a cloud into four groups.
    const cross = `
      <line x1="${x(medRate)}" y1="${padT}" x2="${x(medRate)}" y2="${padT + plotH}"
        stroke="var(--text-secondary)" stroke-width="1.2" stroke-dasharray="4 3" opacity=".7"/>
      <line x1="${padL}" y1="${y(medChange)}" x2="${W - padR}" y2="${y(medChange)}"
        stroke="var(--text-secondary)" stroke-width="1.2" stroke-dasharray="4 3" opacity=".7"/>
      <text class="axis-text" x="${x(medRate) + 5}" y="${padT + 12}" style="fill:var(--text-secondary)">national median rate</text>
      <text class="axis-text" x="${W - padR - 5}" y="${y(medChange) - 5}" text-anchor="end" style="fill:var(--text-secondary)">median 4-year change</text>`;

    const quadLabels = `
      <text class="axis-text" x="${W - padR - 8}" y="${padT + 30}" text-anchor="end" style="fill:var(--sev-5);font-weight:600">High and rising</text>
      <text class="axis-text" x="${padL + 8}" y="${padT + 30}" style="fill:var(--status-warn);font-weight:600">Low but rising fast</text>
      <text class="axis-text" x="${W - padR - 8}" y="${padT + plotH - 10}" text-anchor="end" style="fill:var(--consumer);font-weight:600">High but falling</text>
      <text class="axis-text" x="${padL + 8}" y="${padT + plotH - 10}" style="fill:#8aa0bf;font-weight:600">Low and steady</text>`;

    const dots = visible
      .map((r) => {
        const q = quadrant(r, medRate, medChange)!;
        const rad = Math.max(3, Math.min(13, Math.sqrt(r.total12) * 0.75));
        return `<circle class="dot" cx="${x(r.rate!).toFixed(1)}" cy="${y(r.change4y!).toFixed(1)}" r="${rad.toFixed(1)}"
          fill="${QUAD_COLOUR[q]}" fill-opacity=".62" stroke="${QUAD_COLOUR[q]}" stroke-width="1"
          data-code="${esc(r.code)}"
          data-tip="${tip(
            `${r.name} (${abbr(r.state)})\n${rate(r.rate)} per 10,000 adults · ${num(r.total12)} in 12 months\n4-year change ${delta(r.change4y)}\n${QUADRANT_LABEL[q]}`,
          )}"
          aria-label="${esc(r.name)}"/>`;
      })
      .join('');

    root.querySelector<HTMLElement>('#scatter')!.innerHTML = `
      <svg class="chart" id="scatter-svg" viewBox="0 0 ${W} ${H}" role="img"
        aria-label="Insolvency rate against four-year change, by region">
        ${grid}${cross}${quadLabels}${dots}
        <line class="axis-line" x1="${padL}" y1="${padT + plotH}" x2="${W - padR}" y2="${padT + plotH}"/>
        <line class="axis-line" x1="${padL}" y1="${padT}" x2="${padL}" y2="${padT + plotH}"/>
        <text class="axis-title" x="${padL + plotW / 2}" y="${H - 8}" text-anchor="middle">Insolvencies per 10,000 adults, last 12 months →</text>
        <text class="axis-title" transform="translate(16 ${padT + plotH / 2}) rotate(-90)" text-anchor="middle">← four-year change →</text>
      </svg>`;

    const svg = root.querySelector<SVGSVGElement>('#scatter-svg')!;
    attachSvgZoom(svg);
    svg.querySelectorAll<SVGCircleElement>('.dot').forEach((c) =>
      c.addEventListener('click', () => openRegion(c.dataset.code!)),
    );

    root.querySelectorAll<HTMLButtonElement>('.legend button').forEach((b) =>
      b.setAttribute('aria-pressed', String(!hidden.has(b.dataset.quad!))),
    );
  };

  const counts = Object.fromEntries(
    Object.keys(QUAD_COLOUR).map((q) => [q, pool.filter((r) => quadrant(r, medRate, medChange) === q).length]),
  );

  root.innerHTML = `
    <div class="view-head">
      <h2>Bad, or getting worse?</h2>
      <p>A league table cannot tell a region that has always struggled from one that is deteriorating fast — they can sit side by side with the same rate. This plots today's ${gloss('per 10,000 adults', 'rate')} against how much it has moved in four years, split by the national medians. Dot size is the number of insolvencies. Scroll to zoom, drag to pan, click any region to open it.</p>
    </div>
    <div class="panel">
      <div class="chart-wrap" id="scatter"></div>
      <div class="legend">
        ${Object.entries(QUAD_COLOUR)
          .map(
            ([q, c]) =>
              `<button class="legend-item" data-quad="${q}" aria-pressed="true" data-tip="${tip('Click to hide or show this group')}">
                 <span class="legend-swatch" style="background:${c}"></span>${QUADRANT_LABEL[q]} (${counts[q]})</button>`,
          )
          .join('')}
      </div>
    </div>
    <p style="color:var(--text-tertiary);font-size:var(--font-size-sm);margin-top:var(--space-sm)">
      Regions with fewer than 15 insolvencies in the last twelve months are omitted — a four-year percentage change on single figures is noise, not signal. The vertical axis is capped at +250%; a handful of very small regions sit above it.
    </p>`;

  root.querySelectorAll<HTMLButtonElement>('.legend button').forEach((b) =>
    b.addEventListener('click', () => {
      const q = b.dataset.quad!;
      if (hidden.has(q)) hidden.delete(q);
      else hidden.add(q);
      draw();
    }),
  );

  draw();
}
