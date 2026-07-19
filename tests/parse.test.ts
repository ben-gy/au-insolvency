// Exercises the real pipeline parsing logic (dependency-free parse.mjs), with
// particular attention to the four ways this dataset silently lies.
import { describe, expect, it } from 'vitest';
// @ts-expect-error — plain .mjs, no types
import * as P from '../pipeline/parse.mjs';

describe('parseCsv', () => {
  it('parses a simple table', () => {
    expect(P.parseCsv('a,b\n1,2\n')).toEqual([['a', 'b'], ['1', '2']]);
  });
  it('handles quoted fields containing commas', () => {
    expect(P.parseCsv('a,b\n"Sydney, NSW",7\n')[1]).toEqual(['Sydney, NSW', '7']);
  });
  it('handles escaped quotes', () => {
    expect(P.parseCsv('a\n"say ""hi"""\n')[1]).toEqual(['say "hi"']);
  });
  it('strips a BOM', () => {
    expect(P.parseCsv('﻿a,b\n1,2')[0]).toEqual(['a', 'b']);
  });
  it('tolerates CRLF', () => {
    expect(P.parseCsv('a,b\r\n1,2\r\n')).toEqual([['a', 'b'], ['1', '2']]);
  });
  it('returns objects keyed by header', () => {
    expect(P.parseCsvObjects('x,y\n1,2')).toEqual([{ x: '1', y: '2' }]);
  });
});

describe('parseCount — the "Data not available" trap', () => {
  it('returns null for the suppression sentinel, NOT zero', () => {
    // Number('Data not available') is NaN, but parseInt/`||0` both yield 0.
    // Treating it as 0 would delete 18,908 real cells while looking plausible.
    expect(P.parseCount('Data not available')).toBeNull();
  });
  it('preserves a genuine published zero', () => {
    expect(P.parseCount('0')).toBe(0);
  });
  it('parses ordinary numbers', () => {
    expect(P.parseCount('42')).toBe(42);
  });
  it('returns null for blank', () => {
    expect(P.parseCount('')).toBeNull();
    expect(P.parseCount(undefined)).toBeNull();
  });
});

describe('parseQuarter', () => {
  it('parses a quarter label', () => {
    expect(P.parseQuarter('Mar-26')).toMatchObject({ year: 2026, q: 1, label: 'Mar 2026' });
  });
  it('orders quarters correctly across a year boundary', () => {
    // The raw strings sort lexically wrong: 'Dec-07' < 'Sep-07'.
    const dec = P.parseQuarter('Dec-07').index;
    const sep = P.parseQuarter('Sep-07').index;
    expect(sep).toBeLessThan(dec);
  });
  it('is monotonic across years', () => {
    expect(P.parseQuarter('Mar-08').index).toBeGreaterThan(P.parseQuarter('Dec-07').index);
  });
  it('assigns financial years correctly', () => {
    expect(P.parseQuarter('Mar-26').fy).toBe('2025-26');
    expect(P.parseQuarter('Sep-25').fy).toBe('2025-26');
  });
  it('rejects rubbish', () => {
    expect(P.parseQuarter('')).toBeNull();
    expect(P.parseQuarter('Xyz-26')).toBeNull();
    expect(P.parseQuarter('2026-03')).toBeNull();
  });
  it('round-trips through quarterLabel', () => {
    expect(P.quarterLabel(P.parseQuarter('Jun-19').index)).toBe('Jun 2019');
  });
});

describe('classifyRegionCode — aggregates must not be ranked as regions', () => {
  it('recognises a real SA3', () => {
    expect(P.classifyRegionCode('10102')).toBe('sa3');
  });
  it('recognises GCCSA aggregates that contain the SA3s', () => {
    for (const c of ['1GSYD', '1RNSW', '2GMEL', '8ACTE', '9OTER']) {
      expect(P.classifyRegionCode(c)).toBe('aggregate');
    }
  });
  it('recognises the uncoded-address buckets', () => {
    expect(P.classifyRegionCode('NSW - not in ASGS')).toBe('unknown');
  });
  it('does not mistake an aggregate for an SA3', () => {
    expect(P.classifyRegionCode('1GSYD')).not.toBe('sa3');
  });
});

describe('shapeRegional', () => {
  const row = (q: string, code: string, name: string, flag: string, n: string) => ({
    Quarter: q,
    State: 'New South Wales',
    'ASGS Code': code,
    'ASGS Name': name,
    'In a business or company': flag,
    'Number of people entering a new personal insolvency': n,
  });

  it('excludes aggregate rows from the region list', () => {
    const out = P.shapeRegional([
      row('Mar-26', '10102', 'Queanbeyan', 'Total', '10'),
      row('Mar-26', '1GSYD', 'Greater Sydney', 'Total', '900'),
    ]);
    expect(out.regions.map((r: any) => r.code)).toEqual(['10102']);
    expect(out.excluded.aggregate).toBe(900);
  });

  it('reads Total rather than summing Yes+No+Total', () => {
    const out = P.shapeRegional([
      row('Mar-26', '10102', 'Q', 'Yes', '3'),
      row('Mar-26', '10102', 'Q', 'No', '7'),
      row('Mar-26', '10102', 'Q', 'Total', '10'),
    ]);
    expect(out.regions[0].total).toEqual([10]);
  });

  it('marks a fully published split as covered', () => {
    const out = P.shapeRegional([
      row('Mar-26', '10102', 'Q', 'Yes', '3'),
      row('Mar-26', '10102', 'Q', 'No', '7'),
      row('Mar-26', '10102', 'Q', 'Total', '10'),
    ]);
    expect(out.regions[0].splitCovered).toEqual([10]);
  });

  it('does not treat a suppressed split as a zero split', () => {
    // Both sides withheld, total published — the classic complementary case.
    const out = P.shapeRegional([
      row('Mar-26', '10102', 'Q', 'Yes', 'Data not available'),
      row('Mar-26', '10102', 'Q', 'No', 'Data not available'),
      row('Mar-26', '10102', 'Q', 'Total', '11'),
    ]);
    expect(out.regions[0].total).toEqual([11]);
    expect(out.regions[0].splitCovered).toEqual([0]); // not counted as known
  });

  it('orders quarters chronologically, not lexically', () => {
    const out = P.shapeRegional([
      row('Sep-07', '10102', 'Q', 'Total', '1'),
      row('Dec-07', '10102', 'Q', 'Total', '2'),
      row('Mar-08', '10102', 'Q', 'Total', '3'),
    ]);
    expect(out.regions[0].total).toEqual([1, 2, 3]);
  });

  it('fills quarters a region is missing from with zero rather than shifting the series', () => {
    const out = P.shapeRegional([
      row('Sep-07', '10102', 'A', 'Total', '5'),
      row('Dec-07', '10103', 'B', 'Total', '9'),
    ]);
    const a = out.regions.find((r: any) => r.code === '10102');
    expect(a.total).toEqual([5, 0]);
  });
});

describe('shapeNational — subtotals must not be double counted', () => {
  const row = (type: string, state: string, flag: string, n: string) => ({
    Quarter: 'Mar-26',
    'Type of personal insolvency administration': type,
    State: state,
    'In a business or company': flag,
    'Number of people entering a new personal insolvency': n,
  });

  it('drops both "Total bankruptcies" and "Total personal insolvencies"', () => {
    const out = P.shapeNational([
      row("Debtor's petition", 'New South Wales', 'Total', '1530'),
      row('Sequestration order', 'New South Wales', 'Total', '219'),
      row('Total bankruptcies', 'New South Wales', 'Total', '1749'),
      row('Total personal insolvencies', 'New South Wales', 'Total', '3161'),
    ]);
    expect(out.types).toEqual(["Debtor's petition", 'Sequestration order']);
    const sum = Object.values(out.cells[0]).reduce((a: any, b: any) => a + b, 0);
    expect(sum).toBe(1749); // not 1749 + 1749 + 3161
  });

  it('collects the business/consumer split by state', () => {
    const out = P.shapeNational([
      row('Total personal insolvencies', 'Victoria', 'Yes', '206'),
      row('Total personal insolvencies', 'Victoria', 'No', '800'),
    ]);
    expect(out.split[0]).toEqual({ 'business|Victoria': 206, 'consumer|Victoria': 800 });
  });

  it('groups the three real kinds of insolvency', () => {
    expect(P.ADMIN_GROUPS.map((g: any) => g.key)).toEqual([
      'Bankruptcy', 'Debt agreement', 'Personal insolvency agreement',
    ]);
    expect(P.ADMIN_GROUPS[0].types).toContain("Debtor's petition");
    expect(P.ADMIN_GROUPS[0].types).toContain('Sequestration order');
  });
});

describe('shapeErp — the A59 age-code trap', () => {
  it('excludes A59, which means ages 5-9 despite sorting next to A55', () => {
    expect(P.ADULT_AGE_CODES).not.toContain('A59');
    expect(P.CHILD_AGE_CODES).toContain('A59');
  });
  it('excludes the other child bands', () => {
    for (const c of ['A04', 'A10']) expect(P.ADULT_AGE_CODES).not.toContain(c);
  });
  it('sums only adult bands', () => {
    const rows = [
      { REGION_TYPE: 'SA3', AGE: 'A04', ASGS_2021: '10102', TIME_PERIOD: '2024', OBS_VALUE: '4652' },
      { REGION_TYPE: 'SA3', AGE: 'A59', ASGS_2021: '10102', TIME_PERIOD: '2024', OBS_VALUE: '4597' },
      { REGION_TYPE: 'SA3', AGE: 'A15', ASGS_2021: '10102', TIME_PERIOD: '2024', OBS_VALUE: '4066' },
      { REGION_TYPE: 'SA3', AGE: 'A20', ASGS_2021: '10102', TIME_PERIOD: '2024', OBS_VALUE: '3472' },
    ];
    expect(P.shapeErp(rows).population['10102']).toBe(4066 + 3472);
  });
  it('ignores non-SA3 region types', () => {
    const rows = [
      { REGION_TYPE: 'SA2', AGE: 'A20', ASGS_2021: '10102', TIME_PERIOD: '2024', OBS_VALUE: '99' },
    ];
    expect(P.shapeErp(rows).population['10102']).toBeUndefined();
  });
});

describe('rates and rolling windows', () => {
  it('computes a rate per 10,000', () => {
    expect(P.ratePer10k(50, 100_000)).toBeCloseTo(5);
  });
  it('suppresses rather than clamps below the population floor', () => {
    // An industrial SA3 with 3 residents and 1 insolvency would otherwise post
    // a rate of 3,333 and top every ranking.
    expect(P.ratePer10k(1, 3)).toBeNull();
  });
  it('returns null on non-finite input', () => {
    expect(P.ratePer10k(NaN, 50_000)).toBeNull();
    expect(P.ratePer10k(5, null)).toBeNull();
  });
  it('sums the trailing window', () => {
    expect(P.trailingSum([1, 2, 3, 4, 5, 6], 4)).toBe(18);
  });

  describe('windowEstimate — a withheld quarter is not a zero', () => {
    it('reports an exact count when every quarter was published', () => {
      const e = P.windowEstimate([5, 6, 7, 8], [1, 1, 1, 1], 4);
      expect(e).toMatchObject({ published: 26, withheld: 0, lo: 26, hi: 26, mid: 26, exact: true });
    });

    it('bounds a window containing withheld quarters', () => {
      // Hawkesbury's real shape: one published quarter, three withheld. Summing
      // the raw column gives 0 and announces "no insolvencies at all".
      const e = P.windowEstimate([0, 0, 0, 0], [0, 1, 0, 0], 4);
      expect(e.published).toBe(0);
      expect(e.withheld).toBe(3);
      expect(e.lo).toBe(3); // three withheld quarters are at least 1 each
      expect(e.hi).toBe(6); // and at most 2 each
      expect(e.mid).toBe(4.5);
      expect(e.exact).toBe(false);
    });

    it('never reports a withheld-only window as zero', () => {
      const e = P.windowEstimate([0, 0, 0, 0], [0, 0, 0, 0], 4);
      expect(e.lo).toBeGreaterThan(0);
      expect(e.exact).toBe(false);
    });

    it('keeps a genuine published zero at zero', () => {
      const e = P.windowEstimate([0, 0, 0, 0], [1, 1, 1, 1], 4);
      expect(e.mid).toBe(0);
      expect(e.exact).toBe(true);
    });

    it('adds the withheld allowance on top of published cases', () => {
      const e = P.windowEstimate([10, 0, 4, 0], [1, 0, 1, 0], 4);
      expect(e.published).toBe(14);
      expect(e.lo).toBe(16);
      expect(e.hi).toBe(18);
    });

    it('marks a total as withheld when the Total row is suppressed', () => {
      const rows = [
        { Quarter: 'Mar-26', State: 'NSW', 'ASGS Code': '10102', 'ASGS Name': 'Q',
          'In a business or company': 'Total',
          'Number of people entering a new personal insolvency': 'Data not available' },
      ];
      const out = P.shapeRegional(rows);
      expect(out.regions[0].known).toEqual([0]);
      expect(out.regions[0].total).toEqual([0]);
    });

    it('marks a published zero as known', () => {
      const rows = [
        { Quarter: 'Mar-26', State: 'NSW', 'ASGS Code': '10102', 'ASGS Name': 'Q',
          'In a business or company': 'Total',
          'Number of people entering a new personal insolvency': '0' },
      ];
      expect(P.shapeRegional(rows).regions[0].known).toEqual([1]);
    });
  });
  it('handles a series shorter than the window', () => {
    expect(P.trailingSum([1, 2], 4)).toBe(3);
  });
  it('leaves rolling sums null until the window fills', () => {
    const r = P.rollingSum([1, 2, 3, 4, 5], 4);
    expect(r.slice(0, 3)).toEqual([null, null, null]);
    expect(r[3]).toBe(10);
    expect(r[4]).toBe(14);
  });
  it('computes business share against the covered total', () => {
    expect(P.businessShare(3, 10)).toBeCloseTo(0.3);
    expect(P.businessShare(3, 0)).toBeNull();
  });
  it('finds medians for both parities', () => {
    expect(P.median([3, 1, 2])).toBe(2);
    expect(P.median([4, 1, 2, 3])).toBe(2.5);
    expect(P.median([])).toBeNull();
  });
});
