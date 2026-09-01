const cases = [...document.querySelectorAll('[data-text-entry-case]')];
const status = document.querySelector('[data-text-entry-status]');
for (const card of cases) {
  const query = new URLSearchParams({
    theme: card.dataset.theme, viewport: card.dataset.viewport,
    locale: card.dataset.locale, content: card.dataset.content,
    density: card.dataset.density, motion: card.dataset.motion,
  });
  card.querySelector('iframe').src = `/static/design-system/infinite-canvas-ui/text-entry-case.html?v=2026.08.15.4&${query}`;
}
await Promise.all(cases.map(card => new Promise(resolve => card.querySelector('iframe').addEventListener('load', resolve, { once: true }))));
status.textContent = '6/6 个实时情境已载入';
document.documentElement.dataset.textEntryMatrixStatus = 'ready';
