// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Ben Richardson — https://benrichardson.dev
// Additional terms under AGPL-3.0 section 7(b) apply; see ADDITIONAL-TERMS.md.
// Domain jargon, defined for someone who has never encountered any of it.
// Rendered as click-to-open popovers via [data-term] spans.

export interface Term {
  term: string;
  definition: string;
}

export const GLOSSARY: Record<string, Term> = {
  'personal insolvency': {
    term: 'Personal insolvency',
    definition:
      'A formal, legally binding arrangement entered into by an individual who cannot pay their debts. In Australia there are three kinds: bankruptcy, a debt agreement, and a personal insolvency agreement. It is not the same as simply being in debt or behind on bills — it means a formal process has begun and been recorded by AFSA.',
  },
  bankruptcy: {
    term: 'Bankruptcy',
    definition:
      'The best-known form of personal insolvency. A trustee takes control of the person’s divisible assets and distributes them among creditors; most remaining debts are written off. It normally lasts three years and one day, and is recorded permanently on the National Personal Insolvency Index.',
  },
  "debtor's petition": {
    term: "Debtor's petition",
    definition:
      'A voluntary bankruptcy — the person applies to become bankrupt themselves. This is how the large majority of bankruptcies begin.',
  },
  'sequestration order': {
    term: 'Sequestration order',
    definition:
      'An involuntary bankruptcy — a creditor applies to a court and the court forces the person into bankruptcy. Because someone else initiated it, the ratio of sequestration orders to debtor’s petitions is a rough measure of how aggressively creditors are pursuing debts.',
  },
  'debt agreement': {
    term: 'Debt agreement',
    definition:
      'A formal deal (a Part IX agreement) where the person pays creditors an agreed reduced amount over time, usually without losing their assets. It is an act of bankruptcy but is not bankruptcy itself. Debt agreements collapsed in number after mid-2019, when reforms capped fees and tightened eligibility.',
  },
  'personal insolvency agreement': {
    term: 'Personal insolvency agreement',
    definition:
      'A Part X agreement — a flexible, negotiated arrangement with creditors, administered by a trustee. There are no debt or income limits, so it tends to be used by people with more complex or larger affairs. It is by far the rarest of the three.',
  },
  'business related': {
    term: 'Business related',
    definition:
      'AFSA flags an insolvency as business related when the person was a proprietor or director of a business, or their insolvency arose directly from a business. Everything else is consumer debt. The distinction matters: a business-related insolvency usually reflects a business failing, while a consumer one reflects household finances failing.',
  },
  sa3: {
    term: 'SA3 region',
    definition:
      'Statistical Area Level 3 — an ABS geography of roughly 30,000 to 130,000 people, about the size of a large suburb cluster or a regional town and its surrounds. AFSA reports insolvencies at this level, which is fine enough to be recognisable but coarse enough to protect privacy.',
  },
  'per 10,000 adults': {
    term: 'Rate per 10,000 adults',
    definition:
      'Insolvencies over the last four quarters divided by the resident population aged 15 and over, times 10,000. Raw counts mostly measure how many people live somewhere; the rate is what makes two regions comparable. Bankruptcy legally requires you to be 18, but the ABS does not publish an 18+ population for small areas, so 15+ is used — it shifts every region in almost the same proportion, so the ranking is unaffected.',
  },
  suppression: {
    term: 'Suppression',
    definition:
      'AFSA withholds cells that are small enough to identify someone. Crucially it does this in pairs: when the business-related count would be disclosive, the consumer count is withheld too, so you cannot recover it by subtracting from the published total. A suppressed cell is not a zero — genuine zeros are published as 0.',
  },
  'trailing four quarters': {
    term: 'Trailing four quarters',
    definition:
      'The most recent twelve months, summed. Single quarters are small and seasonal for one region, so a quarter-by-quarter ranking reshuffles itself on noise. Every headline figure here uses the twelve-month window.',
  },
  gccsa: {
    term: 'Greater Capital City area',
    definition:
      'A GCCSA — the ABS grouping that splits each state into its greater capital city and the rest of the state. AFSA’s file lists these alongside SA3s in the same column, even though they contain the SA3s. They are excluded from every ranking and map here, because counting both would count the country twice.',
  },
};

/** Wrap a term in an info-icon trigger. `key` must exist in GLOSSARY. */
export function gloss(key: string, label?: string): string {
  const t = GLOSSARY[key];
  if (!t) return label ?? key;
  return `<span class="glossary-link" data-term="${key}" tabindex="0" role="button" aria-label="Definition of ${t.term}">${label ?? t.term}<span class="gloss-icon" aria-hidden="true">i</span></span>`;
}

let popover: HTMLDivElement | null = null;

function ensurePopover(): HTMLDivElement {
  if (!popover) {
    popover = document.createElement('div');
    popover.className = 'glossary-popover';
    popover.setAttribute('role', 'dialog');
    document.body.appendChild(popover);
  }
  return popover;
}

export function hideGlossary(): void {
  popover?.classList.remove('visible');
}

function show(trigger: Element): void {
  const key = trigger.getAttribute('data-term') ?? '';
  const t = GLOSSARY[key];
  if (!t) return;
  const el = ensurePopover();
  el.innerHTML = `<h4></h4><p></p>`;
  (el.querySelector('h4') as HTMLElement).textContent = t.term;
  (el.querySelector('p') as HTMLElement).textContent = t.definition;
  el.classList.add('visible');

  const r = trigger.getBoundingClientRect();
  const pr = el.getBoundingClientRect();
  let left = r.left;
  let top = r.bottom + 8;
  if (left + pr.width > window.innerWidth - 12) left = window.innerWidth - pr.width - 12;
  if (top + pr.height > window.innerHeight - 12) top = r.top - pr.height - 8;
  el.style.left = `${Math.max(12, left)}px`;
  el.style.top = `${Math.max(12, top)}px`;
}

export function initGlossary(): void {
  document.addEventListener('click', (e) => {
    const trigger = (e.target as Element).closest('.glossary-link');
    if (trigger) {
      e.stopPropagation();
      show(trigger);
      return;
    }
    if (!(e.target as Element).closest('.glossary-popover')) hideGlossary();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') hideGlossary();
    if ((e.key === 'Enter' || e.key === ' ') && (e.target as Element)?.classList?.contains('glossary-link')) {
      e.preventDefault();
      show(e.target as Element);
    }
  });
  window.addEventListener('resize', hideGlossary);
}
