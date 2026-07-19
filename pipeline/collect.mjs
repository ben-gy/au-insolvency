// Fetch the raw sources into pipeline/tmp/. No shaping happens here — that all
// lives in parse.mjs so it can be unit-tested without the network.
//
// Sources:
//   1. AFSA regional quarterly time series  — quarter x SA3 x business-flag
//   2. AFSA quarterly personal insolvencies — quarter x admin-type x state
//   3. ABS ERP by SA3 and age (SDMX csv)    — the per-capita denominator
//   4. ABS ASGS 2021 SA3 boundaries         — real polygons, ArcGIS paged
//
// The two AFSA files live on a stable overwrite URL: the `2024-08` path still
// serves the March 2026 quarter, so it does not need rediscovering each run.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const TMP = join(import.meta.dirname, 'tmp');
mkdirSync(TMP, { recursive: true });

const AFSA_REGIONAL =
  'https://www.afsa.gov.au/sites/default/files/2024-08/regional_quarterly_time_series.csv';
const AFSA_NATIONAL =
  'https://www.afsa.gov.au/sites/default/files/2024-08/quarterly_personal_insolvencies.csv';

// AGE is left unfiltered and narrowed in parse.mjs — asking for the bands by
// name here would bake the A59="5-9" trap into the fetch.
const ABS_ERP =
  'https://data.api.abs.gov.au/rest/data/ERP_ASGS2021/ERP.3..SA3..A?startPeriod=';
const ABS_SA3 =
  'https://geo.abs.gov.au/arcgis/rest/services/ASGS2021/SA3/MapServer/1/query';

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

// afsa.gov.au sits behind a WAF that tarpits requests which do not look like a
// browser — it completes the TLS handshake and then simply never responds, so
// the failure mode is `read ETIMEDOUT` rather than a 403. Sending a full set of
// browser headers is what gets through; a bare user-agent is not enough.
//
// KNOWN LIMITATION: the WAF also appears to rate-limit or block datacenter IP
// ranges, so this can still time out from a GitHub Actions runner even though it
// succeeds from a normal connection. If the quarterly workflow fails with
// ETIMEDOUT, run the pipeline locally and commit `public/data/` — the site reads
// only those committed files, so a failed refresh never breaks production, it
// just leaves the data one quarter stale.
const BROWSER_HEADERS = {
  'user-agent': UA,
  accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'accept-language': 'en-AU,en;q=0.9',
  'accept-encoding': 'gzip, deflate, br',
  'cache-control': 'no-cache',
  pragma: 'no-cache',
  'sec-fetch-dest': 'document',
  'sec-fetch-mode': 'navigate',
  'sec-fetch-site': 'none',
  'upgrade-insecure-requests': '1',
};

const ATTEMPT_TIMEOUT_MS = 90_000;

async function fetchWithRetry(url, { accept, tries = 4 } = {}) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, {
        headers: { ...BROWSER_HEADERS, ...(accept ? { accept } : {}) },
        // Without an explicit signal a tarpitted socket hangs for the platform
        // default, burning most of the job's wall clock before the first retry.
        signal: AbortSignal.timeout(ATTEMPT_TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      return await res.text();
    } catch (err) {
      lastErr = err;
      const wait = 4000 * 2 ** i;
      console.log(`  retry ${i + 1}/${tries} in ${wait}ms — ${err.message}`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  throw lastErr;
}

async function fetchSA3Geo() {
  const feats = [];
  const pageSize = 200;
  for (let offset = 0; offset < 2000; offset += pageSize) {
    const url =
      ABS_SA3 +
      '?where=1%3D1&outFields=sa3_code_2021,sa3_name_2021' +
      '&outSR=4326&resultRecordCount=' + pageSize +
      '&resultOffset=' + offset + '&f=geojson';
    const gj = JSON.parse(await fetchWithRetry(url));
    const got = gj.features ?? [];
    feats.push(...got);
    console.log(`  SA3 boundaries offset ${offset} -> ${got.length} (total ${feats.length})`);
    if (got.length < pageSize) break;
  }
  if (feats.length < 300) {
    throw new Error(`only ${feats.length} SA3 polygons — source incomplete, refusing to ship`);
  }
  return { type: 'FeatureCollection', features: feats };
}

async function main() {
  console.log('1/4 AFSA regional quarterly time series...');
  const regional = await fetchWithRetry(AFSA_REGIONAL);
  writeFileSync(join(TMP, 'regional.csv'), regional);
  console.log(`  ${regional.split('\n').length} lines`);

  console.log('2/4 AFSA quarterly personal insolvencies...');
  const national = await fetchWithRetry(AFSA_NATIONAL);
  writeFileSync(join(TMP, 'national.csv'), national);
  console.log(`  ${national.split('\n').length} lines`);

  console.log('3/4 ABS ERP by SA3 and age...');
  const startYear = new Date().getUTCFullYear() - 3;
  const erp = await fetchWithRetry(ABS_ERP + startYear, { accept: 'text/csv' });
  writeFileSync(join(TMP, 'erp.csv'), erp);
  console.log(`  ${erp.split('\n').length} lines`);

  console.log('4/4 ABS ASGS 2021 SA3 boundaries...');
  const geo = await fetchSA3Geo();
  writeFileSync(join(TMP, 'sa3-raw.geojson'), JSON.stringify(geo));
  console.log(`  ${geo.features.length} polygons`);

  console.log('Collect done.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
