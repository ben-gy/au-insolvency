// Hand-rolled SVG chart primitives. No chart library — these are simple enough
// that a dependency would cost more than it saves, and every mark needs a
// [data-tip] hover anyway.

import { esc, tip } from './format';

export const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * Nice round tick values covering [0, max].
 *
 * The final tick is at or above `max`, so the top gridline always sits at or
 * past the tallest bar. Stopping below it (which a plain `v <= max` loop does
 * whenever max is not a multiple of the step) leaves the chart looking clipped
 * and the largest value unlabelled.
 */
export function ticks(max: number, count = 4): number[] {
  if (!Number.isFinite(max) || max <= 0) return [0];
  const raw = max / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = ([1, 2, 2.5, 5, 10].find((m) => m * mag >= raw) ?? 10) * mag;
  const out: number[] = [];
  for (let v = 0; v < max - step * 1e-9; v += step) out.push(v);
  out.push(out.length ? out[out.length - 1] + step : step);
  return out;
}

/**
 * A sparkline over a series that may contain nulls.
 *
 * Nulls are genuine gaps (the rolling window has not filled yet, or a value is
 * suppressed) and are drawn as breaks in the line. Zero-filling them would
 * invent a crash to zero that never happened.
 */
export function sparkline(
  values: (number | null)[],
  w = 110,
  h = 26,
  colour = 'var(--accent-primary)',
): string {
  const pts = values.map((v, i) => ({ v, i }));
  const finite = pts.filter((p) => p.v !== null && Number.isFinite(p.v)) as { v: number; i: number }[];
  if (finite.length < 2) return `<svg class="spark" width="${w}" height="${h}" aria-hidden="true"></svg>`;
  const max = Math.max(...finite.map((p) => p.v));
  const min = Math.min(...finite.map((p) => p.v));
  const span = max - min || 1;
  const x = (i: number) => (i / Math.max(1, values.length - 1)) * (w - 2) + 1;
  const y = (v: number) => h - 1 - ((v - min) / span) * (h - 2);

  let d = '';
  let pen = false;
  for (const p of pts) {
    if (p.v === null || !Number.isFinite(p.v)) { pen = false; continue; }
    d += `${pen ? 'L' : 'M'}${x(p.i).toFixed(1)} ${y(p.v).toFixed(1)}`;
    pen = true;
  }
  const last = finite[finite.length - 1];
  return `<svg class="spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true">
    <path d="${d}" fill="none" stroke="${colour}" stroke-width="1.4" stroke-linejoin="round" stroke-linecap="round"/>
    <circle cx="${x(last.i).toFixed(1)}" cy="${y(last.v).toFixed(1)}" r="1.9" fill="${colour}"/>
  </svg>`;
}

export interface BarDatum {
  label: string;
  value: number;
  colour?: string;
  tipText?: string;
  id?: string;
}

/** Horizontal bar chart with a value axis and a hover tip on every bar. */
export function horizontalBars(
  data: BarDatum[],
  opts: { width?: number; rowHeight?: number; labelWidth?: number; unit?: string } = {},
): string {
  const width = opts.width ?? 860;
  const rowH = opts.rowHeight ?? 26;
  const labelW = opts.labelWidth ?? 210;
  const padR = 56;
  const h = data.length * rowH + 28;
  const max = Math.max(...data.map((d) => d.value), 0) || 1;
  const plotW = width - labelW - padR;
  const x = (v: number) => (v / max) * plotW;

  const grid = ticks(max)
    .map(
      (t) =>
        `<line class="grid-line" x1="${labelW + x(t)}" y1="14" x2="${labelW + x(t)}" y2="${h - 14}"/>
         <text class="axis-text" x="${labelW + x(t)}" y="${h - 3}" text-anchor="middle">${fmtTick(t)}</text>`,
    )
    .join('');

  const bars = data
    .map((d, i) => {
      const y = 14 + i * rowH;
      const bw = Math.max(1, x(d.value));
      return `<g class="bar-row"${d.id ? ` data-id="${esc(d.id)}" style="cursor:pointer"` : ''}>
        <text class="axis-text" x="${labelW - 8}" y="${y + rowH / 2}" text-anchor="end" dominant-baseline="middle"
          style="fill:var(--text-secondary)">${esc(clip(d.label, 30))}</text>
        <rect class="bar" x="${labelW}" y="${y + 3}" width="${bw}" height="${rowH - 8}" rx="2"
          fill="${d.colour ?? 'var(--accent-primary)'}"
          data-tip="${tip(d.tipText ?? `${d.label}: ${d.value.toLocaleString('en-AU')}${opts.unit ?? ''}`)}"
          aria-label="${esc(d.label)}: ${esc(String(d.value))}"/>
        <text class="axis-text num" x="${labelW + bw + 6}" y="${y + rowH / 2}" dominant-baseline="middle"
          style="fill:var(--text-secondary)">${fmtTick(d.value)}</text>
      </g>`;
    })
    .join('');

  return `<svg class="chart" viewBox="0 0 ${width} ${h}" role="img">${grid}${bars}</svg>`;
}

function fmtTick(v: number): string {
  if (v >= 1000) return `${(v / 1000).toFixed(v % 1000 === 0 ? 0 : 1)}k`;
  return v % 1 === 0 ? String(v) : v.toFixed(1);
}

export function clip(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

export interface SeriesSpec {
  key: string;
  label: string;
  colour: string;
  values: number[];
}

/**
 * Stacked area chart over quarters, with an invisible hover column per quarter
 * so the tooltip works anywhere in the plot rather than only exactly on a band.
 */
export function stackedArea(
  series: SeriesSpec[],
  labels: string[],
  opts: { width?: number; height?: number; annotations?: { at: number; text: string }[] } = {},
): string {
  const width = opts.width ?? 900;
  const height = opts.height ?? 360;
  const padL = 48;
  const padR = 12;
  const padT = 12;
  const padB = 30;
  const n = labels.length;
  if (!n || !series.length) return '<div class="empty-state">No data.</div>';

  const totals = labels.map((_, i) => series.reduce((a, s) => a + (s.values[i] ?? 0), 0));
  const max = Math.max(...totals, 1);
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;
  const x = (i: number) => padL + (i / Math.max(1, n - 1)) * plotW;
  const y = (v: number) => padT + plotH - (v / max) * plotH;

  const grid = ticks(max)
    .map(
      (t) =>
        `<line class="grid-line" x1="${padL}" y1="${y(t)}" x2="${width - padR}" y2="${y(t)}"/>
         <text class="axis-text" x="${padL - 6}" y="${y(t)}" text-anchor="end" dominant-baseline="middle">${fmtTick(t)}</text>`,
    )
    .join('');

  // Bottom-up cumulative bands.
  const cum = labels.map(() => 0);
  const bands = series
    .map((s) => {
      const top: string[] = [];
      const bottom: string[] = [];
      for (let i = 0; i < n; i++) {
        const y0 = cum[i];
        const y1 = y0 + (s.values[i] ?? 0);
        top.push(`${x(i).toFixed(1)} ${y(y1).toFixed(1)}`);
        bottom.push(`${x(i).toFixed(1)} ${y(y0).toFixed(1)}`);
        cum[i] = y1;
      }
      const d = `M${top.join('L')}L${bottom.reverse().join('L')}Z`;
      return `<path d="${d}" fill="${s.colour}" fill-opacity="0.9" stroke="none"/>`;
    })
    .join('');

  const step = Math.max(1, Math.round(n / 9));
  const xLabels = labels
    .map((l, i) =>
      i % step === 0
        ? `<text class="axis-text" x="${x(i)}" y="${height - 8}" text-anchor="middle">${esc(l)}</text>`
        : '',
    )
    .join('');

  // Annotation labels are staggered down the plot rather than all sitting on
  // one line: on a narrow chart (the drill-down panel is 520px) two events a
  // few quarters apart otherwise overprint each other into unreadable mush.
  const visibleNotes = (opts.annotations ?? []).filter((a) => a.at >= 0 && a.at < n);
  const notes = visibleNotes
    .map((a, i) => {
      const labelY = padT + 10 + (i % 3) * 13;
      // Flip the label to the left of its line when it would run off the edge.
      const flip = x(a.at) + 8 * a.text.length > width - padR;
      return `<line x1="${x(a.at)}" y1="${padT}" x2="${x(a.at)}" y2="${padT + plotH}"
           stroke="var(--text-primary)" stroke-width="1" stroke-dasharray="3 3" opacity=".45"/>
         <text class="axis-text" x="${x(a.at) + (flip ? -4 : 4)}" y="${labelY}"
           text-anchor="${flip ? 'end' : 'start'}" style="fill:var(--text-secondary)">${esc(a.text)}</text>`;
    })
    .join('');

  const hover = labels
    .map((l, i) => {
      const bw = plotW / Math.max(1, n - 1);
      const lines = series
        .map((s) => `${s.label}: ${(s.values[i] ?? 0).toLocaleString('en-AU')}`)
        .reverse()
        .join('\n');
      return `<rect x="${x(i) - bw / 2}" y="${padT}" width="${bw}" height="${plotH}" fill="transparent"
        data-tip="${tip(`${l}\nTotal: ${totals[i].toLocaleString('en-AU')}\n${lines}`)}"/>`;
    })
    .join('');

  return `<svg class="chart" viewBox="0 0 ${width} ${height}" role="img">
    ${grid}${bands}${notes}
    <line class="axis-line" x1="${padL}" y1="${padT + plotH}" x2="${width - padR}" y2="${padT + plotH}"/>
    ${xLabels}${hover}
  </svg>`;
}

export function legend(items: { label: string; colour: string }[]): string {
  return `<div class="legend">${items
    .map(
      (i) =>
        `<span class="legend-item"><span class="legend-swatch" style="background:${i.colour}"></span>${esc(i.label)}</span>`,
    )
    .join('')}</div>`;
}
