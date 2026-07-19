const NF = new Intl.NumberFormat('en-AU');

export function num(n: number | null | undefined, dp = 0): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  return dp > 0
    ? n.toLocaleString('en-AU', { minimumFractionDigits: dp, maximumFractionDigits: dp })
    : NF.format(Math.round(n));
}

export function rate(n: number | null | undefined): string {
  return n === null || n === undefined || !Number.isFinite(n) ? '—' : n.toFixed(1);
}

export function pct(n: number | null | undefined, dp = 1): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  return `${(n * 100).toFixed(dp)}%`;
}

/** Signed percentage, for change columns. */
export function delta(n: number | null | undefined, dp = 0): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  const s = (n * 100).toFixed(dp);
  return `${n > 0 ? '+' : ''}${s}%`;
}

export const STATE_ABBR: Record<string, string> = {
  'New South Wales': 'NSW',
  Victoria: 'Vic',
  Queensland: 'Qld',
  'South Australia': 'SA',
  'Western Australia': 'WA',
  Tasmania: 'Tas',
  'Northern Territory': 'NT',
  'Australian Capital Territory': 'ACT',
  'Other Territories': 'Other',
  Other: 'Other',
};

export const abbr = (state: string): string => STATE_ABBR[state] ?? state;

/** Escape text destined for innerHTML. Used everywhere a name reaches the DOM. */
export function esc(s: unknown): string {
  return String(s ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string,
  );
}

/**
 * Escape for a `data-tip` attribute.
 *
 * `data-tip` is rendered with `textContent`, so any markup in it shows up as
 * literal angle brackets rather than formatting — keep tips plain text and let
 * this handle the quoting.
 */
export const tip = (s: string): string => esc(s);

export function quarterLabel(index: number): string {
  const year = Math.floor(index / 4);
  const q = (index % 4) + 1;
  return `${['Mar', 'Jun', 'Sep', 'Dec'][q - 1]} ${year}`;
}

/** Colour for a value relative to the national median: higher = worse here. */
export function severity(value: number | null, median: number): string {
  if (value === null || !Number.isFinite(value)) return 'var(--text-tertiary)';
  const r = value / median;
  if (r >= 2) return 'var(--sev-5)';
  if (r >= 1.4) return 'var(--sev-4)';
  if (r >= 1.05) return 'var(--sev-3)';
  if (r >= 0.7) return 'var(--sev-2)';
  return 'var(--sev-1)';
}
