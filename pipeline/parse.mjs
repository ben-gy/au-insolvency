// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Ben Richardson — https://benrichardson.dev
// Additional terms under AGPL-3.0 section 7(b) apply; see ADDITIONAL-TERMS.md.
// Pure, dependency-free parsing + shaping for the AFSA personal insolvency data.
//
// Everything in here is a pure function of its input so the test suite can
// exercise the real parsing logic without touching the network. `collect.mjs`
// does the fetching, `aggregate.mjs` does the writing; this module is the part
// that is easy to get quietly wrong, so it is the part that is tested.

// ── ABS ERP age bands ───────────────────────────────────────────────
// Adults are 15+. Note `A59` is **ages 5-9**, NOT 55-59 — the ABS code names
// are not lower-bound labels and `A59` sorts innocently between A55 and A60.
// Summing the codes by name puts primary schoolers in the adult denominator.
// Verified against CL_AGE: A04="0-4", A59="5-9", A10="10-14".
export const CHILD_AGE_CODES = ['A04', 'A59', 'A10'];
export const ADULT_AGE_CODES = [
  'A15', 'A20', 'A25', 'A30', 'A35', 'A40', 'A45', 'A50',
  'A55', 'A60', 'A65', 'A70', 'A75', 'A80', '8599',
];

// ── CSV ─────────────────────────────────────────────────────────────
/** RFC4180-ish CSV parse. Handles quoted fields containing commas and "" escapes. */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  const src = text.replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; } else { quoted = false; }
      } else field += c;
      continue;
    }
    if (c === '"') { quoted = true; continue; }
    if (c === ',') { row.push(field); field = ''; continue; }
    if (c === '\r') continue;
    if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue; }
    field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.length > 1 || (r[0] ?? '').trim() !== '');
}

/** CSV text -> array of objects keyed by the header row. */
export function parseCsvObjects(text) {
  const rows = parseCsv(text);
  if (!rows.length) return [];
  const head = rows[0].map((h) => h.trim());
  return rows.slice(1).map((r) => {
    const o = {};
    head.forEach((h, i) => { o[h] = (r[i] ?? '').trim(); });
    return o;
  });
}

// ── Quarters ────────────────────────────────────────────────────────
const MONTH_Q = { Mar: 1, Jun: 2, Sep: 3, Dec: 4 };

/**
 * "Mar-26" -> { year: 2026, q: 1, index: 8105, label: "Mar 2026", fy: "2025-26" }
 *
 * `index` is a dense sortable integer (year*4 + q-1). The raw strings sort
 * lexically wrong ("Dec-07" < "Sep-07"), which silently reverses every time
 * series if you skip this.
 */
export function parseQuarter(s) {
  const m = /^([A-Za-z]{3})-(\d{2})$/.exec((s ?? '').trim());
  if (!m) return null;
  const q = MONTH_Q[m[1][0].toUpperCase() + m[1].slice(1, 3).toLowerCase()];
  if (!q) return null;
  const year = 2000 + Number(m[2]);
  return {
    year,
    q,
    index: year * 4 + (q - 1),
    label: `${m[1][0].toUpperCase() + m[1].slice(1, 3).toLowerCase()} ${year}`,
    // Quarter ending Mar/Jun belong to the FY that started the previous July.
    fy: q <= 2 ? `${year - 1}-${String(year % 100).padStart(2, '0')}`
              : `${year}-${String((year + 1) % 100).padStart(2, '0')}`,
  };
}

/** Quarter index -> short label, for axes. */
export function quarterLabel(index) {
  const year = Math.floor(index / 4);
  const q = (index % 4) + 1;
  return `${['Mar', 'Jun', 'Sep', 'Dec'][q - 1]} ${year}`;
}

// ── Region codes ────────────────────────────────────────────────────
/**
 * AFSA mixes three different kinds of thing in one `ASGS Code` column:
 *   "10102"            a real SA3                     -> 'sa3'
 *   "1GSYD" / "1RNSW"  a GCCSA aggregate (Greater Sydney / Rest of NSW)
 *                      which CONTAINS the SA3s above  -> 'aggregate'
 *   "NSW - not in ASGS" insolvencies whose address could not be coded
 *                                                     -> 'unknown'
 *
 * Treating all 364 codes as regions double-counts the entire country: the
 * aggregates re-add every SA3. Only 'sa3' rows may be ranked, mapped or rated.
 */
export function classifyRegionCode(code) {
  const c = (code ?? '').trim();
  if (/^\d{5}$/.test(c)) return 'sa3';
  if (/not in ASGS/i.test(c)) return 'unknown';
  if (/^\d[A-Z]{4}$/.test(c)) return 'aggregate';
  return 'unknown';
}

const BUSINESS = { Yes: 'business', No: 'consumer', Total: 'total' };

/**
 * AFSA writes the literal string `Data not available` into the count column
 * rather than leaving it blank. `Number('Data not available')` is NaN, but
 * `parseInt` / `Number(x) || 0` both turn it into a very convincing **0** — and
 * it appears 18,908 times, so that mistake silently deletes a fifth of the
 * dataset while every total still looks plausible.
 */
export const SUPPRESSED = 'Data not available';
export function parseCount(raw) {
  const s = (raw ?? '').trim();
  if (!s || s === SUPPRESSED) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/**
 * Shape the AFSA regional CSV into per-SA3 quarterly series.
 *
 * Two things about the `In a business or company` column:
 *
 * 1. It carries its own subtotal (`Total`) alongside `Yes`/`No`, so summing the
 *    column double-counts. Read `Total` for totals.
 * 2. The Yes/No split is **complementarily suppressed**: whenever one side
 *    would be disclosive, BOTH sides are withheld so the other cannot be
 *    recovered by subtracting from the published total. Measured on the real
 *    file: 8,259 cells suppress both sides, only 50 suppress one. Explicit `0`
 *    IS published (2,800 cells), so a suppressed cell is *not* a zero.
 *
 * Consequence: the split is unusable as a headline SA3 metric — median coverage
 * is ~55% of recent insolvencies and only 75 of 340 regions are fully
 * published. So we carry the split as a lower bound *plus its coverage*, and
 * let the app show a business share only where coverage is high enough to mean
 * something. Totals are unaffected and remain fully reliable.
 */
export function shapeRegional(rows) {
  const regions = new Map();
  const quarters = new Set();
  const excluded = { aggregate: 0, unknown: 0 };

  for (const r of rows) {
    const kind = classifyRegionCode(r['ASGS Code']);
    const qt = parseQuarter(r['Quarter']);
    const series = BUSINESS[r['In a business or company']];
    if (!qt || !series) continue;
    const n = parseCount(r['Number of people entering a new personal insolvency']);

    if (kind !== 'sa3') {
      if (series === 'total' && n !== null) excluded[kind] += n;
      continue;
    }

    quarters.add(qt.index);
    const code = r['ASGS Code'].trim();
    let reg = regions.get(code);
    if (!reg) {
      reg = { code, name: r['ASGS Name'].trim(), state: r['State'].trim(), series: new Map() };
      regions.set(code, reg);
    }
    let cell = reg.series.get(qt.index);
    if (!cell) {
      cell = { total: 0, business: 0, consumer: 0, totalKnown: false };
      reg.series.set(qt.index, cell);
    }
    if (n === null) continue;
    cell[series] += n;
    if (series === 'total') {
      cell.total = n;
      cell.totalKnown = true;
    }
  }

  const qIndex = [...quarters].sort((a, b) => a - b);
  const out = [...regions.values()].map((reg) => {
    const total = [], business = [], consumer = [], splitCovered = [], known = [];
    for (const qi of qIndex) {
      const c = reg.series.get(qi) ?? { total: 0, business: 0, consumer: 0, totalKnown: false };
      total.push(c.total);
      business.push(c.business);
      consumer.push(c.consumer);
      // 1 where AFSA published this quarter's total, 0 where it withheld it.
      // Without this a withheld quarter reads as a hard zero, and a populous
      // region whose recent quarters are all withheld (Hawkesbury, Manly)
      // gets reported as having had NO insolvencies at all.
      known.push(c.totalKnown ? 1 : 0);
      // Published-split volume for this quarter, used to compute coverage.
      splitCovered.push(c.business + c.consumer === c.total && c.total > 0 ? c.total : 0);
    }
    return {
      code: reg.code, name: reg.name, state: reg.state,
      total, business, consumer, splitCovered, known,
    };
  }).sort((a, b) => a.code.localeCompare(b.code));

  return { quarters: qIndex, regions: out, excluded };
}

/** Trailing n-quarter sum ending at the last element. */
export function trailingSum(series, n = 4) {
  return series.slice(Math.max(0, series.length - n)).reduce((a, b) => a + b, 0);
}

/**
 * A withheld quarter is worth 1 or 2 insolvencies — never 0, because AFSA
 * publishes genuine zeros as `0`. So a window containing withheld quarters has
 * a known floor and a tight ceiling, and the midpoint is at worst half a case
 * per withheld quarter out.
 *
 * Returns the published floor, the bounds, the midpoint used for rates, and
 * whether the window was complete.
 */
export const SUPPRESSED_MIN = 1;
export const SUPPRESSED_MAX = 2;
export function windowEstimate(totals, known, n = 4) {
  const from = Math.max(0, totals.length - n);
  const published = totals.slice(from).reduce((a, b) => a + b, 0);
  const withheld = known.slice(from).reduce((a, b) => a + (b ? 0 : 1), 0);
  return {
    published,
    withheld,
    lo: published + withheld * SUPPRESSED_MIN,
    hi: published + withheld * SUPPRESSED_MAX,
    mid: published + withheld * ((SUPPRESSED_MIN + SUPPRESSED_MAX) / 2),
    exact: withheld === 0,
  };
}

/** Rolling n-quarter sums, one per position (null until the window is full). */
export function rollingSum(series, n = 4) {
  const out = [];
  let acc = 0;
  for (let i = 0; i < series.length; i++) {
    acc += series[i];
    if (i >= n) acc -= series[i - n];
    out.push(i >= n - 1 ? acc : null);
  }
  return out;
}

/**
 * Rate per 10,000 adults.
 *
 * Suppressed (null) rather than clamped below the population floor: tiny SA3s
 * — industrial estates, national parks — otherwise post absurd rates off a
 * handful of people and dominate every ranking.
 */
export const POP_FLOOR = 3000;
export function ratePer10k(count, population, floor = POP_FLOOR) {
  if (!Number.isFinite(count) || !Number.isFinite(population)) return null;
  if (population < floor) return null;
  return (count / population) * 10_000;
}

/** business / total, as a 0..1 share. Null when there is nothing to divide. */
export function businessShare(business, total) {
  if (!Number.isFinite(business) || !Number.isFinite(total) || total <= 0) return null;
  return business / total;
}

export function median(values) {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const mid = v.length >> 1;
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

/** Shape the ABS ERP SDMX csv into { sa3code: adultPopulation } for the newest year present. */
export function shapeErp(rows) {
  const byYear = new Map();
  for (const r of rows) {
    if (r.REGION_TYPE !== 'SA3') continue;
    if (!ADULT_AGE_CODES.includes(r.AGE)) continue;
    const year = Number(r.TIME_PERIOD);
    const code = (r.ASGS_2021 ?? '').trim();
    const v = Number(r.OBS_VALUE);
    if (!Number.isFinite(year) || !Number.isFinite(v) || !/^\d{5}$/.test(code)) continue;
    if (!byYear.has(year)) byYear.set(year, new Map());
    const m = byYear.get(year);
    m.set(code, (m.get(code) ?? 0) + v);
  }
  const years = [...byYear.keys()].sort((a, b) => b - a);
  for (const y of years) {
    const m = byYear.get(y);
    // Guard against a part-published vintage: the newest TIME_PERIOD sometimes
    // exists with only a handful of regions in it.
    if (m.size >= 300) return { year: y, population: Object.fromEntries(m) };
  }
  return { year: years[0] ?? null, population: Object.fromEntries(byYear.get(years[0]) ?? []) };
}

/**
 * Shape the AFSA national CSV into quarter x administration-type x state, and
 * separately the business/consumer split by state.
 *
 * State-level cells are large enough that the complementary suppression which
 * makes the SA3 split unusable barely bites here — which is exactly why the
 * business-vs-consumer story is told at this level instead.
 */
export function shapeNational(rows) {
  const byQuarter = new Map();
  const splitByQuarter = new Map();
  const types = new Set();
  const states = new Set();

  for (const r of rows) {
    const qt = parseQuarter(r['Quarter']);
    if (!qt) continue;
    const n = parseCount(r['Number of people entering a new personal insolvency']);
    if (n === null) continue;
    const type = r['Type of personal insolvency administration'].trim();
    const state = r['State'].trim();
    const flag = r['In a business or company'].trim();

    // The type column mixes leaves with TWO levels of subtotal:
    //   Total personal insolvencies = Total bankruptcies + Debt agreement
    //                               + Personal insolvency agreement + Deceased estate
    //   Total bankruptcies          = Debtor's petition + Sequestration order
    // Verified on Mar-2026: 1530 + 219 = 1749 = Total bankruptcies, and
    // 1749 + 1356 + 50 + 6 = 3161 = Total personal insolvencies.
    // Summing the column naively counts every bankruptcy twice.
    const isTypeTotal = type === 'Total personal insolvencies';
    const isSubtotal = isTypeTotal || type === 'Total bankruptcies';

    if (flag === 'Total' && !isSubtotal) {
      types.add(type);
      if (state !== 'Total') states.add(state);
      if (!byQuarter.has(qt.index)) byQuarter.set(qt.index, new Map());
      const m = byQuarter.get(qt.index);
      m.set(`${type}|${state}`, (m.get(`${type}|${state}`) ?? 0) + n);
    }

    // Business/consumer split, across all administration types.
    if (isTypeTotal && (flag === 'Yes' || flag === 'No') && state !== 'Total') {
      if (!splitByQuarter.has(qt.index)) splitByQuarter.set(qt.index, new Map());
      const m = splitByQuarter.get(qt.index);
      const key = `${flag === 'Yes' ? 'business' : 'consumer'}|${state}`;
      m.set(key, (m.get(key) ?? 0) + n);
    }
  }

  // Union of both maps: a quarter can legitimately carry a split without
  // carrying leaf-type cells (and vice versa), and taking only one map's keys
  // silently drops the other's data for that quarter.
  const quarters = [...new Set([...byQuarter.keys(), ...splitByQuarter.keys()])].sort((a, b) => a - b);
  return {
    quarters,
    types: [...types].sort(),
    states: [...states].sort(),
    // The three things a person actually enters. Bankruptcy is reached two
    // ways — you file (debtor's petition) or a creditor forces you
    // (sequestration order) — and that distinction is the interesting one.
    groups: ADMIN_GROUPS,
    cells: quarters.map((qi) => Object.fromEntries(byQuarter.get(qi) ?? [])),
    split: quarters.map((qi) => Object.fromEntries(splitByQuarter.get(qi) ?? [])),
  };
}

export const ADMIN_GROUPS = [
  { key: 'Bankruptcy', types: ["Debtor's petition", 'Sequestration order', 'Deceased estate'] },
  { key: 'Debt agreement', types: ['Debt agreement'] },
  { key: 'Personal insolvency agreement', types: ['Personal insolvency agreement'] },
];
