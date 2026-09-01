const cases = [...document.querySelectorAll('[data-dialog-case]')];
const status = document.querySelector('[data-dialog-status]');

for (const card of cases) {
  const query = new URLSearchParams({ theme: card.dataset.theme, viewport: card.dataset.viewport, locale: card.dataset.locale, content: card.dataset.content, motion: card.dataset.motion });
  card.querySelector('iframe').src = `/static/design-system/infinite-canvas-ui/dialog-case.html?${query}`;
}

await Promise.all(cases.map(card => new Promise(resolve => card.querySelector('iframe').addEventListener('load', resolve, { once: true }))));
await Promise.all(cases.map(card => new Promise((resolve, reject) => {
  const frame = card.querySelector('iframe');
  const deadline = performance.now() + 15000;
  const inspect = () => {
    const value = frame.contentDocument?.documentElement.dataset.dialogCaseStatus;
    if (value === 'ready' || value === 'failed') return resolve();
    if (performance.now() >= deadline) return reject(new Error('Dialog case timed out'));
    requestAnimationFrame(inspect);
  };
  inspect();
})));
const ready = cases.every(card => card.querySelector('iframe').contentDocument?.documentElement.dataset.dialogCaseStatus === 'ready');
status.textContent = ready ? '6/6 个实时情境已载入' : '部分情境载入失败';
document.documentElement.dataset.dialogMatrixStatus = ready ? 'ready' : 'failed';
