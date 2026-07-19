export interface Region {
  code: string;
  name: string;
  state: string;
  pop: number | null;
  /**
   * Insolvencies in the trailing four quarters. A midpoint estimate where any
   * quarter was withheld — see `exact`, `lo12`/`hi12`.
   */
  total12: number;
  /** Sum of the quarters AFSA actually published — a hard floor. */
  published12: number;
  /** How many of the four quarters were withheld (each worth 1–2 cases). */
  withheld12: number;
  /** True when all four quarters were published, so total12 is a real count. */
  exact: boolean;
  lo12: number;
  hi12: number;
  /** The four quarters before those, for the year-on-year change. */
  prev12: number;
  change: number | null;
  change4y: number | null;
  /** Per 10,000 adults (15+). Null where the population is below the floor. */
  rate: number | null;
  /** Share of this region's insolvencies whose business/consumer split AFSA published. */
  splitCoverage: number;
  business12: number | null;
  bizShare: number | null;
  /** Rolling four-quarter totals, one per quarter (null until the window fills). */
  series: (number | null)[];
}

export interface National {
  quarters: number[];
  types: string[];
  states: string[];
  groups: { key: string; types: string[] }[];
  /** Per quarter: `"{type}|{state}"` -> count. */
  cells: Record<string, number>[];
  /** Per quarter: `"business|{state}"` / `"consumer|{state}"` -> count. */
  split: Record<string, number>[];
}

export interface Meta {
  generated: string;
  quarters: number[];
  quarterLabels: string[];
  latestQuarter: string;
  firstQuarter: string;
  erpYear: number;
  popFloor: number;
  windowQuarters: number;
  minSplitCoverage: number;
  counts: {
    regions: number;
    rated: number;
    suppressed: number;
    quarters: number;
    unknownAddress: number;
    nationalTotal12: number;
    splitPublishedRegions: number;
    splitCoverageNational: number;
    /** Regions whose last four quarters were all published (no estimate needed). */
    exactRegions: number;
    withheldQuarterCells: number;
  };
  medians: { rate: number; change4y: number; bizShare: number };
  source: Record<string, string>;
}

export interface Dataset {
  regions: Region[];
  national: National;
  meta: Meta;
}
