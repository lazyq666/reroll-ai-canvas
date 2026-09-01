const cases = [...document.querySelectorAll('[data-selection-adjustment-case]')];
const status = document.querySelector('[data-selection-adjustment-status]');

for (const card of cases) {
  const query = new URLSearchParams({
    theme: card.dataset.theme,
    viewport: card.dataset.viewport,
    locale: card.dataset.locale,
    content: card.dataset.content,
    density: card.dataset.density,
    motion: card.dataset.motion,
  });
  card.querySelector('iframe').src = `/static/design-system/infinite-canvas-ui/selection-adjustment-case.html?v=2026.08.14.2&${query}`;
}

await Promise.all(cases.map(card => new Promise(resolve => {
  card.querySelector('iframe').addEventListener('load', resolve, { once: true });
})));
await Promise.all(cases.map(card => new Promise((resolve, reject) => {
  const frame = card.querySelector('iframe');
  const deadline = performance.now() + 15000;
  const inspect = () => {
    const caseStatus = frame.contentDocument?.documentElement.dataset.selectionAdjustmentCaseStatus;
    if (caseStatus === 'ready' || caseStatus === 'failed') return resolve();
    if (performance.now() >= deadline) return reject(new Error('Selection and Adjustment case timed out'));
    requestAnimationFrame(inspect);
  };
  inspect();
})));
const ready = cases.every(card => (
  card.querySelector('iframe').contentDocument?.documentElement.dataset.selectionAdjustmentCaseStatus === 'ready'
));
status.textContent = ready ? '6/6 个实时情境已载入' : '部分情境载入失败';
document.documentElement.dataset.selectionAdjustmentMatrixStatus = ready ? 'ready' : 'failed';
