// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Ben Richardson — https://benrichardson.dev
// Additional terms under AGPL-3.0 section 7(b) apply; see ADDITIONAL-TERMS.md.
import './styles.css';
import { initTooltip } from './components/tooltip';
import { initGlossary, gloss, hideGlossary } from './glossary';
import { esc } from './format';
import type { Dataset } from './types';
import { renderDrawer } from './drilldown';
import { renderRankings } from './views/rankings';
import { renderMap } from './views/map';
import { renderTrajectory } from './views/trajectory';
import { renderExplorer } from './views/explorer';
import { renderTimeline } from './views/timeline';
import { renderKinds } from './views/kinds';
import { renderSplit } from './views/split';
import { renderDistribution } from './views/distribution';
import { renderInsights } from './views/insights';

const VIEWS = [
  { id: 'rankings', label: 'Rankings', render: renderRankings },
  { id: 'map', label: 'Map', render: renderMap },
  { id: 'trajectory', label: 'Trajectory', render: renderTrajectory },
  { id: 'explorer', label: 'Explorer', render: renderExplorer },
  { id: 'timeline', label: 'Timeline', render: renderTimeline },
  { id: 'kinds', label: 'Kinds of insolvency', render: renderKinds },
  { id: 'split', label: 'Business vs consumer', render: renderSplit },
  { id: 'distribution', label: 'Distribution', render: renderDistribution },
  { id: 'insights', label: 'Insights', render: renderInsights },
] as const;

export type ViewId = (typeof VIEWS)[number]['id'];

const STORE_KEY = 'au-insolvency:view';

interface Route { view: ViewId; region?: string; filter?: string }

function parseHash(): Route {
  const h = location.hash.replace(/^#/, '');
  const params = new URLSearchParams(h);
  const view = (params.get('v') ?? '') as ViewId;
  const known = VIEWS.some((v) => v.id === view);
  const stored = localStorage.getItem(STORE_KEY) as ViewId | null;
  return {
    view: known ? view : (VIEWS.some((v) => v.id === stored) && stored ? stored : 'rankings'),
    region: params.get('r') ?? undefined,
    filter: params.get('q') ?? undefined,
  };
}

export function navigate(patch: Partial<Route>, replace = false): void {
  const cur = parseHash();
  const next = { ...cur, ...patch };
  const params = new URLSearchParams();
  params.set('v', next.view);
  if (next.region) params.set('r', next.region);
  if (next.filter) params.set('q', next.filter);
  const url = `#${params.toString()}`;
  if (replace) history.replaceState(null, '', url);
  else location.hash = url;
  if (replace) render();
}

let data: Dataset | null = null;

async function load(): Promise<Dataset> {
  const bust = `?v=${Date.now().toString(36).slice(0, 6)}`;
  const [regions, national, meta] = await Promise.all(
    ['regions', 'national', 'meta'].map(async (f) => {
      const res = await fetch(`data/${f}.json${bust}`);
      if (!res.ok) throw new Error(`Could not load ${f}.json (HTTP ${res.status})`);
      return res.json();
    }),
  );
  return { regions, national, meta } as Dataset;
}

function shell(): void {
  const app = document.getElementById('app')!;
  app.innerHTML = `
    <header class="site-header">
      <div class="header-inner">
        <div class="brand">
          <h1>Personal Insolvency</h1>
          <span class="brand-sub">Where Australians go broke</span>
        </div>
        <div class="header-spacer"></div>
        <button class="icon-btn" id="about-btn" aria-label="About this site" title="About this site">?</button>
      </div>
      <div class="nav-wrap">
        <nav class="nav-tabs" role="tablist" aria-label="Views">
          ${VIEWS.map(
            (v) =>
              `<button class="nav-tab" role="tab" data-view="${v.id}" aria-selected="false">${v.label}</button>`,
          ).join('')}
        </nav>
      </div>
    </header>
    <main class="main-content" id="view-root"><div class="skeleton"></div></main>
    <footer class="site-footer">
      <div class="footer-inner">
        <p id="footer-source"></p>
        <p>Built by <a href="https://benrichardson.dev/">benrichardson.dev</a> · <a href="https://sites.benrichardson.dev" target="_blank" rel="noopener">more tools &amp; sites</a></p>
      </div>
    </footer>
    <div class="overlay" id="overlay"></div>
    <aside class="drawer" id="drawer" role="dialog" aria-label="Region detail" aria-modal="true"></aside>
    <div class="modal" id="about-modal" role="dialog" aria-label="About this site" aria-modal="true"></div>
  `;

  app.querySelectorAll<HTMLButtonElement>('.nav-tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      localStorage.setItem(STORE_KEY, btn.dataset.view!);
      navigate({ view: btn.dataset.view as ViewId, region: undefined, filter: undefined });
    });
  });

  // Sticky table headers must offset by the FULL header (title bar + nav tabs),
  // not the title bar alone, or they park mid-table and cover the first rows.
  // Measured rather than hard-coded: the nav wraps to two lines on narrow
  // viewports and any guess is wrong at some width.
  //
  // Written to `--sticky-top`, NOT `--header-h`: the latter also sets
  // `.header-inner`'s min-height, so measuring the header into it makes the
  // header grow by its own nav height on every observation (54 → 99 → 144 → …).
  const header = document.querySelector<HTMLElement>('.site-header')!;
  const syncHeaderHeight = () => {
    document.documentElement.style.setProperty('--sticky-top', `${header.offsetHeight}px`);
  };
  syncHeaderHeight();
  new ResizeObserver(syncHeaderHeight).observe(header);

  document.getElementById('about-btn')!.addEventListener('click', openAbout);
  document.getElementById('overlay')!.addEventListener('click', closeOverlays);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeOverlays();
  });
}

function closeOverlays(): void {
  document.getElementById('overlay')!.classList.remove('open');
  document.getElementById('drawer')!.classList.remove('open');
  document.getElementById('about-modal')!.classList.remove('open');
  hideGlossary();
  const cur = parseHash();
  if (cur.region) navigate({ region: undefined }, true);
}

function openAbout(): void {
  const m = document.getElementById('about-modal')!;
  const meta = data?.meta;
  m.innerHTML = `
    <button class="icon-btn modal-close" aria-label="Close">✕</button>
    <h2>About this site</h2>
    <p>Every ${gloss('personal insolvency')} recorded in Australia, mapped to the ${gloss('sa3', 'SA3 region')} where the person lived, from September 2007 to ${esc(meta?.latestQuarter ?? '')}.</p>

    <h3>Where the data comes from</h3>
    <p>The Australian Financial Security Authority (AFSA) administers the personal insolvency system and publishes quarterly counts by region and by type. This site joins two of its files to ABS resident population estimates so regions can be compared fairly, and to official ABS boundaries so they can be mapped.</p>
    <ul>
      <li>AFSA regional quarterly time series — ${esc(String(meta?.counts.quarters ?? 0))} quarters × ${esc(String(meta?.counts.regions ?? 0))} regions</li>
      <li>AFSA quarterly personal insolvencies — by administration type and state</li>
      <li>ABS Estimated Resident Population (${esc(String(meta?.erpYear ?? ''))}) — the per-capita denominator</li>
      <li>ABS ASGS 2021 SA3 boundaries</li>
    </ul>

    <h3>How to read the headline number</h3>
    <p>Every figure uses the ${gloss('trailing four quarters')} and, where it is a rate, is expressed ${gloss('per 10,000 adults')}. Counts alone mostly measure population size.</p>

    <h3>Things worth knowing</h3>
    <ul>
      <li><strong>${gloss('suppression', 'Small numbers are withheld')}.</strong> AFSA suppresses the business/consumer split in pairs, so it cannot be recovered by subtraction. Only ${esc(String(meta?.counts.splitPublishedRegions ?? 0))} of ${esc(String(meta?.counts.regions ?? 0))} regions have enough published detail for a business share to mean anything, and this site shows one only for those.</li>
      <li><strong>${gloss('gccsa', 'Aggregate rows are excluded')}.</strong> AFSA's file mixes greater-capital-city aggregates into the same column as the regions they contain. Including them would count the country twice.</li>
      <li><strong>A low rate is not proof of prosperity.</strong> Formal insolvency requires access to the system. Some remote communities record almost none while experiencing severe hardship.</li>
      <li><strong>Small quarters are withheld too, and a withheld quarter is not a zero.</strong> AFSA suppresses a region's quarterly count when it is small enough to identify someone, but publishes genuine zeros as <code>0</code> — so a withheld quarter is one or two cases. Where that happens the twelve-month total shown is a midpoint estimate (accurate to within about half a case per withheld quarter), marked with an asterisk and shown as a range in the region detail. ${esc(String(meta?.counts.exactRegions ?? 0))} of ${esc(String(meta?.counts.regions ?? 0))} regions had every quarter published.</li>
      <li><strong>${esc(String(meta?.counts.suppressed ?? 0))} regions have no rate</strong> because their population is under ${esc(String(meta?.popFloor ?? 0))} — islands, reserves and industrial areas where a single insolvency would produce an absurd rate.</li>
      <li><strong>${esc(String(meta?.counts.unknownAddress ?? 0))} insolvencies</strong> in the latest period could not be assigned to any region and appear in national totals only.</li>
    </ul>

    <h3>Updates</h3>
    <p>AFSA publishes quarterly; this site refreshes on the same cadence. Data last rebuilt ${esc(meta ? new Date(meta.generated).toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' }) : '')}.</p>

    <h3>Not financial advice</h3>
    <p>This is a statistical explorer, not guidance. If you are struggling with debt, the free National Debt Helpline (1800 007 007) provides confidential financial counselling.</p>
  `;
  m.querySelector('.modal-close')!.addEventListener('click', closeOverlays);
  document.getElementById('overlay')!.classList.add('open');
  m.classList.add('open');
  (m.querySelector('.modal-close') as HTMLElement).focus();
}

export function openRegion(code: string): void {
  navigate({ region: code });
}

function render(): void {
  if (!data) return;
  const route = parseHash();
  document.querySelectorAll<HTMLButtonElement>('.nav-tab').forEach((b) => {
    b.setAttribute('aria-selected', String(b.dataset.view === route.view));
  });

  const root = document.getElementById('view-root')!;
  const view = VIEWS.find((v) => v.id === route.view) ?? VIEWS[0];
  root.scrollTop = 0;
  try {
    view.render(root, data, route.filter);
  } catch (err) {
    root.innerHTML = `<div class="error-state"><p>Something went wrong drawing this view.</p><p>${esc(
      err instanceof Error ? err.message : String(err),
    )}</p></div>`;
  }

  const drawer = document.getElementById('drawer')!;
  const overlay = document.getElementById('overlay')!;
  if (route.region) {
    const region = data.regions.find((r) => r.code === route.region);
    if (region) {
      renderDrawer(drawer, region, data);
      drawer.querySelector('.drawer-close')?.addEventListener('click', closeOverlays);
      overlay.classList.add('open');
      drawer.classList.add('open');
      (drawer.querySelector('.drawer-close') as HTMLElement | null)?.focus();
    }
  } else if (!document.getElementById('about-modal')!.classList.contains('open')) {
    drawer.classList.remove('open');
    overlay.classList.remove('open');
  }
}

async function boot(): Promise<void> {
  shell();
  initTooltip();
  initGlossary();
  window.addEventListener('hashchange', render);

  try {
    data = await load();
  } catch (err) {
    document.getElementById('view-root')!.innerHTML = `
      <div class="error-state">
        <p>Could not load the insolvency data.</p>
        <p>${esc(err instanceof Error ? err.message : String(err))}</p>
        <p><button class="icon-btn" style="width:auto;padding:0 12px;border-radius:8px" onclick="location.reload()">Retry</button></p>
      </div>`;
    return;
  }

  document.getElementById('footer-source')!.innerHTML =
    `Source: AFSA quarterly personal insolvency statistics (${esc(data.meta.firstQuarter)} – ${esc(data.meta.latestQuarter)}), ` +
    `ABS Estimated Resident Population ${esc(String(data.meta.erpYear))} and ABS ASGS 2021 boundaries. ` +
    `Rates are per 10,000 residents aged 15+.`;

  render();
}

void boot();
