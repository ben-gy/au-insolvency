import { describe, expect, it } from 'vitest';
import { buildInsights, groupSeries, quadrant, quarterTotal, typeTotal } from '../src/analysis';
import { delta, esc, num, pct, rate, severity, abbr } from '../src/format';
import type { Dataset, National, Region } from '../src/types';

function region(over: Partial<Region> = {}): Region {
  return {
    code: '10102', name: 'Queanbeyan', state: 'New South Wales', pop: 50_000,
    total12: 40, published12: 40, withheld12: 0, exact: true, lo12: 40, hi12: 40,
    prev12: 30, change: 0.33, change4y: 0.2, rate: 8,
    splitCoverage: 1, business12: 12, bizShare: 0.3,
    series: [null, null, null, 30, 40], ...over,
  };
}

const national: National = {
  quarters: [8100, 8101, 8102, 8103],
  types: ["Debtor's petition", 'Sequestration order', 'Debt agreement', 'Personal insolvency agreement'],
  states: ['New South Wales', 'Victoria'],
  groups: [
    { key: 'Bankruptcy', types: ["Debtor's petition", 'Sequestration order', 'Deceased estate'] },
    { key: 'Debt agreement', types: ['Debt agreement'] },
    { key: 'Personal insolvency agreement', types: ['Personal insolvency agreement'] },
  ],
  cells: [
    { "Debtor's petition|New South Wales": 100, 'Debt agreement|New South Wales': 200 },
    { "Debtor's petition|New South Wales": 90, 'Debt agreement|New South Wales': 150 },
    { "Debtor's petition|New South Wales": 80, 'Debt agreement|New South Wales': 60 },
    { "Debtor's petition|New South Wales": 70, 'Sequestration order|New South Wales': 30, 'Debt agreement|New South Wales': 50 },
  ],
  split: [{}, {}, {}, { 'business|New South Wales': 30, 'consumer|New South Wales': 120 }],
};

describe('national aggregation helpers', () => {
  it('sums one type across states', () => {
    expect(typeTotal(national, 0, "Debtor's petition")).toBe(100);
  });
  it('sums a whole quarter', () => {
    expect(quarterTotal(national, 0)).toBe(300);
  });
  it('excludes the state subtotal column from quarter totals', () => {
    const withTotal: National = {
      ...national,
      cells: [{ "Debtor's petition|New South Wales": 10, "Debtor's petition|Total": 10 }],
      quarters: [8100],
    };
    expect(quarterTotal(withTotal, 0)).toBe(10);
  });
  it('rolls leaf types up into a group', () => {
    expect(groupSeries(national, 'Bankruptcy')).toEqual([100, 90, 80, 100]);
  });
  it('returns zeros for an unknown group rather than throwing', () => {
    expect(groupSeries(national, 'Nope')).toEqual([0, 0, 0, 0]);
  });
});

describe('quadrant classification', () => {
  const medRate = 5;
  const medChange = 0.1;
  it('flags high rate and rising as entrenched', () => {
    expect(quadrant(region({ rate: 9, change4y: 0.5 }), medRate, medChange)).toBe('entrenched');
  });
  it('flags low rate but rising fast as emerging', () => {
    expect(quadrant(region({ rate: 2, change4y: 0.5 }), medRate, medChange)).toBe('emerging');
  });
  it('flags high rate but falling as improving', () => {
    expect(quadrant(region({ rate: 9, change4y: -0.2 }), medRate, medChange)).toBe('improving');
  });
  it('flags low and steady', () => {
    expect(quadrant(region({ rate: 2, change4y: -0.2 }), medRate, medChange)).toBe('stable');
  });
  it('returns null when either axis is missing', () => {
    expect(quadrant(region({ rate: null }), medRate, medChange)).toBeNull();
    expect(quadrant(region({ change4y: null }), medRate, medChange)).toBeNull();
  });
});

describe('buildInsights', () => {
  const data: Dataset = {
    regions: [
      region({ code: '1', name: 'Bad Place', rate: 20, total12: 200, change4y: 1.4 }),
      region({ code: '2', name: 'Mid', rate: 5, total12: 60, change4y: 0.1 }),
      region({ code: '3', name: 'Quiet', rate: 0, total12: 0, change4y: null }),
      region({ code: '4', name: 'Small', rate: null, pop: 10, total12: 0 }),
    ],
    national,
    meta: {
      generated: '2026-07-19T00:00:00Z', quarters: national.quarters,
      quarterLabels: ['a', 'b', 'c', 'd'], latestQuarter: 'Dec 2025', firstQuarter: 'Mar 2025',
      erpYear: 2024, popFloor: 3000, windowQuarters: 4, minSplitCoverage: 0.7,
      counts: {
        regions: 4, rated: 3, suppressed: 1, quarters: 4, unknownAddress: 93,
        nationalTotal12: 260, splitPublishedRegions: 2, splitCoverageNational: 0.74,
      },
      medians: { rate: 5, change4y: 0.1, bizShare: 0.3 },
      source: {},
    },
  };

  const insights = buildInsights(data);

  it('produces several findings', () => {
    expect(insights.length).toBeGreaterThanOrEqual(4);
  });
  it('names the worst region and links to it', () => {
    const worst = insights.find((i) => i.title.includes('Bad Place'));
    expect(worst?.code).toBe('1');
    expect(worst?.severity).toBe('alert');
  });
  it('discloses the withheld split rather than hiding it', () => {
    expect(insights.some((i) => /withheld/i.test(i.title))).toBe(true);
  });
  it('caveats zero-insolvency regions instead of calling them prosperous', () => {
    const zero = insights.find((i) => /no insolvencies/i.test(i.title));
    expect(zero?.body).toMatch(/not automatically a sign of prosperity/i);
  });

  it('never calls a region zero when its quarters were merely withheld', () => {
    // The Hawkesbury/Manly bug: three of four quarters withheld sums to 0 and
    // reads as "no insolvencies at all" for a populous outer-Sydney region.
    const withheld = buildInsights({
      ...data,
      regions: [
        region({ code: '9', name: 'Hawkesbury', total12: 4.5, published12: 0,
                 withheld12: 3, exact: false, lo12: 3, hi12: 6, rate: 2.2 }),
        region({ code: '2', name: 'Mid', rate: 5, total12: 60 }),
      ],
    });
    const zero = withheld.find((i) => /no insolvencies/i.test(i.title));
    expect(zero).toBeUndefined();
    expect(withheld.some((i) => /withheld quarter/i.test(i.title))).toBe(true);
  });
  it('reports the debt agreement collapse', () => {
    expect(insights.some((i) => /Debt agreements have fallen/i.test(i.title))).toBe(true);
  });
  it('never emits NaN or undefined in a title or body', () => {
    for (const i of insights) {
      expect(i.title).not.toMatch(/NaN|undefined/);
      expect(i.body).not.toMatch(/NaN|undefined/);
    }
  });
  it('returns an empty list rather than throwing on an empty dataset', () => {
    expect(buildInsights({ ...data, regions: [] })).toEqual([]);
  });
});

describe('formatters', () => {
  it('groups thousands', () => expect(num(1234567)).toBe('1,234,567'));
  it('renders zero, not a dash', () => expect(num(0)).toBe('0'));
  it('dashes null and NaN', () => {
    expect(num(null)).toBe('—');
    expect(num(NaN)).toBe('—');
  });
  it('formats rates to one decimal', () => expect(rate(4.8153)).toBe('4.8'));
  it('formats percentages', () => expect(pct(0.3191, 1)).toBe('31.9%'));
  it('signs deltas', () => {
    expect(delta(0.208)).toBe('+21%');
    expect(delta(-0.5)).toBe('-50%');
  });
  it('abbreviates states and passes unknown ones through', () => {
    expect(abbr('New South Wales')).toBe('NSW');
    expect(abbr('Atlantis')).toBe('Atlantis');
  });
  it('escapes HTML so region names cannot inject markup', () => {
    expect(esc('<img src=x onerror=1>')).toBe('&lt;img src=x onerror=1&gt;');
    expect(esc(`O'Connor & "Co"`)).toBe('O&#39;Connor &amp; &quot;Co&quot;');
  });
  it('grades severity against the median, worst first', () => {
    expect(severity(20, 5)).toBe('var(--sev-5)');
    expect(severity(1, 5)).toBe('var(--sev-1)');
    expect(severity(null, 5)).toBe('var(--text-tertiary)');
  });
});
