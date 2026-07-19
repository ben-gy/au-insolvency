# Personal Insolvency — Build Review

This file exists only to create a reviewable PR. All code is already deployed on `main`.

**Merge this PR to acknowledge the build.** Closing without merging is also fine.

## Links

- **Custom domain:** https://au-insolvency.benrichardson.dev
- **GitHub Pages:** https://ben-gy.github.io/au-insolvency/ *(301s to the custom domain)*

## Status at hand-over

DNS is live and the site is **serving and verified over `http://`** — the deployed bundle hash
(`index-CSh68CGt.js`) matches the local production build byte-for-byte, and all data, SEO and
IndexNow assets return 200.

The Let's Encrypt certificate was still issuing at hand-over (`https_enforced: false`) after a
~15-minute poll and two CNAME cycles, which is normal for a freshly pointed domain. No action should
be needed — it typically completes within the hour. To confirm:

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://au-insolvency.benrichardson.dev/
gh api repos/ben-gy/au-insolvency/pages --jq '.https_enforced'
```

If it has not resolved, cycle the CNAME once more:

```bash
gh api repos/ben-gy/au-insolvency/pages -X PUT -f cname=""
sleep 3
gh api repos/ben-gy/au-insolvency/pages -X PUT -f cname="au-insolvency.benrichardson.dev"
```

## Verification performed

Against the **production build** (`vite preview` of `dist/`, byte-identical to what is deployed):

- All 9 views render, zero console errors
- Real pointer clicks (not synthetic `.click()`): map polygon → drill-down opens (`#v=map&r=31502`,
  "Outback - North"); scatter dot → drill-down opens (`#v=trajectory&r=21305`, "Wyndham")
- Drag on the scatter pans without firing the click
- About modal opens **from the map view** and paints above Leaflet's panes
- No horizontal overflow at 375px on any of the 9 views, or with the drill-down open
- 107 Vitest tests pass; `tsc` clean
