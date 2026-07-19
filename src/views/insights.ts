import type { Dataset } from '../types';
import { esc } from '../format';
import { buildInsights } from '../analysis';
import { openRegion } from '../main';

export function renderInsights(root: HTMLElement, data: Dataset): void {
  const insights = buildInsights(data);

  root.innerHTML = `
    <div class="view-head">
      <h2>What the numbers say</h2>
      <p>Findings computed directly from the data on every rebuild — outliers, concentration, and the shifts that a headline total hides. Nothing here is hand-written commentary; if the next quarter changes the picture, these change with it.</p>
    </div>
    ${
      insights.length
        ? `<div class="insight-grid">${insights
            .map(
              (i) => `<article class="insight ${i.severity}">
                <h3>${esc(i.title)}</h3>
                <p>${esc(i.body)}</p>
                ${i.code ? `<button data-code="${esc(i.code)}">Open this region →</button>` : ''}
              </article>`,
            )
            .join('')}</div>`
        : '<div class="empty-state">No findings could be computed from this release.</div>'
    }`;

  root.querySelectorAll<HTMLButtonElement>('.insight button[data-code]').forEach((b) =>
    b.addEventListener('click', () => openRegion(b.dataset.code!)),
  );
}
