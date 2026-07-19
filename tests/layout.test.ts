// Positional tests for the hand-rolled layouts. Area-only assertions pass on
// visually broken output (a histogram that stacks every bar at x=0 conserves
// total area perfectly), so these assert in-bounds, no-overlap and no-NaN.
import { describe, expect, it } from 'vitest';
import { histogram } from '../src/utils/histogram';
import { ticks, sparkline, stackedArea, horizontalBars } from '../src/charts';
import { clampViewBox, zoomViewBox } from '../src/utils/svgZoom';

describe('histogram binning', () => {
  const values = [0.5, 1.2, 3.4, 5.6, 8.9, 12.1, 16.0, 2.2, 4.4];

  it('produces the requested number of bins', () => {
    expect(histogram(values, 8)).toHaveLength(8);
  });

  it('conserves every value — none dropped, none double counted', () => {
    const bins = histogram(values, 8);
    expect(bins.reduce((a, b) => a + b.count, 0)).toBe(values.length);
  });

  it('includes the maximum value in the top bin', () => {
    // A half-open top interval silently drops the single worst region.
    const bins = histogram(values, 8);
    expect(bins[bins.length - 1].count).toBeGreaterThanOrEqual(1);
  });

  it('produces contiguous, non-overlapping, ascending bins', () => {
    const bins = histogram(values, 10);
    for (let i = 0; i < bins.length; i++) {
      expect(bins[i].hi).toBeGreaterThan(bins[i].lo);
      if (i > 0) expect(bins[i].lo).toBeCloseTo(bins[i - 1].hi, 9);
    }
  });

  it('never emits NaN bounds', () => {
    for (const b of histogram(values, 12)) {
      expect(Number.isFinite(b.lo)).toBe(true);
      expect(Number.isFinite(b.hi)).toBe(true);
    }
  });

  it('spans exactly [0, max]', () => {
    const bins = histogram(values, 16);
    expect(bins[0].lo).toBe(0);
    expect(bins[bins.length - 1].hi).toBeCloseTo(Math.max(...values), 9);
  });

  it('degrades gracefully on empty and all-zero input', () => {
    expect(histogram([], 8)).toEqual([]);
    expect(histogram([0, 0], 8)).toHaveLength(1);
  });

  it('ignores non-finite values', () => {
    const bins = histogram([1, NaN, 2, Infinity], 4);
    expect(bins.reduce((a, b) => a + b.count, 0)).toBe(2);
  });
});

describe('axis ticks', () => {
  it('starts at zero and covers the maximum', () => {
    const t = ticks(97);
    expect(t[0]).toBe(0);
    expect(t[t.length - 1]).toBeGreaterThanOrEqual(97);
  });
  it('is strictly ascending with a constant step', () => {
    const t = ticks(1234);
    for (let i = 1; i < t.length; i++) expect(t[i]).toBeGreaterThan(t[i - 1]);
    const step = t[1] - t[0];
    for (let i = 1; i < t.length; i++) expect(t[i] - t[i - 1]).toBeCloseTo(step, 6);
  });
  it('handles degenerate maxima', () => {
    expect(ticks(0)).toEqual([0]);
    expect(ticks(NaN)).toEqual([0]);
    expect(ticks(-5)).toEqual([0]);
  });
});

describe('sparkline', () => {
  it('emits no NaN coordinates', () => {
    const svg = sparkline([1, 5, 3, 9, 4]);
    expect(svg).not.toMatch(/NaN/);
  });

  it('breaks the path at nulls instead of drawing through them', () => {
    // Zero-filling a gap invents a crash to zero that never happened.
    const svg = sparkline([null, null, 5, 6, null, 8]);
    const moves = svg.match(/M/g) ?? [];
    expect(moves.length).toBeGreaterThan(1);
  });

  it('keeps every point inside the viewBox', () => {
    const w = 110;
    const h = 26;
    const svg = sparkline([3, 18, 1, 22], w, h);
    for (const m of svg.matchAll(/[ML](\d+\.?\d*) (\d+\.?\d*)/g)) {
      expect(Number(m[1])).toBeGreaterThanOrEqual(0);
      expect(Number(m[1])).toBeLessThanOrEqual(w);
      expect(Number(m[2])).toBeGreaterThanOrEqual(0);
      expect(Number(m[2])).toBeLessThanOrEqual(h);
    }
  });

  it('degrades to an empty chart rather than throwing on a flat/short series', () => {
    expect(sparkline([])).toContain('<svg');
    expect(sparkline([null, null])).toContain('<svg');
    expect(sparkline([4, 4, 4])).not.toMatch(/NaN/);
  });
});

describe('horizontalBars', () => {
  const data = [
    { label: 'Bankruptcy', value: 1749 },
    { label: 'Debt agreement', value: 1356 },
    { label: 'PIA', value: 50 },
  ];

  it('emits one bar per datum, none with negative width', () => {
    const svg = horizontalBars(data);
    const widths = [...svg.matchAll(/<rect class="bar"[^>]*width="([-\d.]+)"/g)].map((m) => Number(m[1]));
    expect(widths).toHaveLength(3);
    for (const w of widths) expect(w).toBeGreaterThan(0);
  });

  it('does not let bars overlap vertically', () => {
    const svg = horizontalBars(data, { rowHeight: 26 });
    const rects = [...svg.matchAll(/<rect class="bar"[^>]*y="([\d.]+)" width="[-\d.]+" height="([\d.]+)"/g)]
      .map((m) => ({ y: Number(m[1]), h: Number(m[2]) }))
      .sort((a, b) => a.y - b.y);
    for (let i = 1; i < rects.length; i++) {
      expect(rects[i].y).toBeGreaterThanOrEqual(rects[i - 1].y + rects[i - 1].h - 0.5);
    }
  });

  it('scales the largest bar to the plot width and no further', () => {
    const width = 860;
    const labelWidth = 210;
    const svg = horizontalBars(data, { width, labelWidth });
    const widths = [...svg.matchAll(/<rect class="bar"[^>]*width="([\d.]+)"/g)].map((m) => Number(m[1]));
    expect(Math.max(...widths)).toBeLessThanOrEqual(width - labelWidth);
  });

  it('gives every bar a hover tip', () => {
    const svg = horizontalBars(data);
    expect((svg.match(/data-tip=/g) ?? []).length).toBe(3);
  });

  it('emits no NaN and survives an all-zero series', () => {
    expect(horizontalBars([{ label: 'a', value: 0 }])).not.toMatch(/NaN/);
  });

  it('escapes markup in labels rather than injecting it', () => {
    const svg = horizontalBars([{ label: '<script>x</script>', value: 1 }]);
    expect(svg).not.toContain('<script>');
    expect(svg).toContain('&lt;script&gt;');
  });
});

describe('stackedArea', () => {
  const labels = ['Mar 2025', 'Jun 2025', 'Sep 2025', 'Dec 2025'];
  const series = [
    { key: 'a', label: 'A', colour: '#111', values: [10, 12, 9, 11] },
    { key: 'b', label: 'B', colour: '#222', values: [5, 4, 7, 6] },
  ];

  it('emits one band per series with no NaN coordinates', () => {
    const svg = stackedArea(series, labels);
    expect((svg.match(/<path d="M/g) ?? []).length).toBe(2);
    expect(svg).not.toMatch(/NaN/);
  });

  it('keeps every coordinate inside the viewBox', () => {
    const width = 900;
    const height = 360;
    const svg = stackedArea(series, labels, { width, height });
    for (const m of svg.matchAll(/(\d+\.\d+) (\d+\.\d+)/g)) {
      expect(Number(m[1])).toBeGreaterThanOrEqual(0);
      expect(Number(m[1])).toBeLessThanOrEqual(width);
      expect(Number(m[2])).toBeGreaterThanOrEqual(0);
      expect(Number(m[2])).toBeLessThanOrEqual(height);
    }
  });

  it('gives every quarter a hover column', () => {
    const svg = stackedArea(series, labels);
    expect((svg.match(/data-tip=/g) ?? []).length).toBe(labels.length);
  });

  it('handles an empty series without throwing', () => {
    expect(stackedArea([], [])).toContain('empty-state');
  });

  it('survives an all-zero stack', () => {
    const zero = [{ key: 'z', label: 'Z', colour: '#333', values: [0, 0, 0, 0] }];
    expect(stackedArea(zero, labels)).not.toMatch(/NaN/);
  });
});

describe('svgZoom viewBox maths', () => {
  const base = { x: 0, y: 0, w: 900, h: 560 };

  it('never zooms out past the base box', () => {
    const vb = zoomViewBox(base, base, 0.2, 450, 280);
    expect(vb.w).toBeLessThanOrEqual(base.w);
    expect(vb).toEqual(base);
  });

  it('clamps panning to stay inside the base box', () => {
    const vb = clampViewBox({ x: -500, y: -500, w: 450, h: 280 }, base);
    expect(vb.x).toBeGreaterThanOrEqual(base.x);
    expect(vb.y).toBeGreaterThanOrEqual(base.y);
  });

  it('keeps the zoomed box within the base bounds on the far edge', () => {
    const vb = clampViewBox({ x: 9999, y: 9999, w: 450, h: 280 }, base);
    expect(vb.x + vb.w).toBeLessThanOrEqual(base.x + base.w + 1e-6);
    expect(vb.y + vb.h).toBeLessThanOrEqual(base.y + base.h + 1e-6);
  });

  it('respects the maximum zoom', () => {
    let vb = { ...base };
    for (let i = 0; i < 40; i++) vb = zoomViewBox(vb, base, 1.4, 450, 280, 1, 8);
    expect(base.w / vb.w).toBeLessThanOrEqual(8 + 1e-9);
  });

  it('zooms about the focus point, keeping it roughly stationary', () => {
    const fx = 300;
    const fy = 200;
    const vb = zoomViewBox(base, base, 2, fx, fy);
    const before = (fx - base.x) / base.w;
    const after = (fx - vb.x) / vb.w;
    expect(Math.abs(before - after)).toBeLessThan(0.01);
  });

  it('never produces NaN', () => {
    const vb = zoomViewBox(base, base, 1.4, 0, 0);
    for (const v of Object.values(vb)) expect(Number.isFinite(v)).toBe(true);
  });
});
